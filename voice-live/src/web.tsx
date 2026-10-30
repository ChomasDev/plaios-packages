"use client";

import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfigurationEditor,
  InstanceSummary,
  Label,
  MicrofrontendFrame,
  type MicrofrontendProps,
} from "@plaios/microfrontend";

interface VoiceData {
  configured?: boolean;
  model?: string;
  voice?: string;
  createSession?: () => Promise<{ clientSecret: string }>;
  callTool?: (name: string, args: unknown) => Promise<unknown>;
  remember?: (role: "user" | "assistant", text: string) => Promise<void>;
  newChat?: () => Promise<void>;
}

type Status = "idle" | "connecting" | "live";
interface Line { role: "user" | "assistant" | "tool"; text: string }

// Devices belong to the browser you talk from, so the choice is kept there, not in the server config.
const INPUT_KEY = "plaios.voice-live.input";
const OUTPUT_KEY = "plaios.voice-live.output";
const canPickOutput = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

// shortcut: tool output is cut at 20k chars, add summarization if a capability returns more
const MAX_TOOL_OUTPUT = 20_000;

export default function VoiceLiveMicrofrontend({ component, data, onSaveConfig }: MicrofrontendProps<VoiceData>) {
  const dataRef = useRef(data);
  dataRef.current = data;
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>();
  const [lines, setLines] = useState<Line[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const callRef = useRef<{ pc: RTCPeerConnection; mic: MediaStream; audio: AudioContext; frame: number }>(null);
  const levelsRef = useRef({ user: 0, assistant: 0 });
  const playerRef = useRef<HTMLAudioElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [inputId, setInputId] = useStoredChoice(INPUT_KEY);
  const [outputId, setOutputId] = useStoredChoice(OUTPUT_KEY);

  const refreshDevices = () => void navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => undefined);
  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices?.addEventListener("devicechange", refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", refreshDevices);
  }, []);
  // Browsers hide device names and ids until the page may use the microphone.
  const hidden = devices.some((device) => device.kind === "audioinput" && !device.label);
  const unlockDevices = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      refreshDevices();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  // The speaker can change mid-call; the microphone is picked when the call starts.
  useEffect(() => {
    if (canPickOutput && playerRef.current) void playerRef.current.setSinkId(outputId).catch((caught: unknown) => setError(`Speaker: ${String(caught)}`));
  }, [outputId]);

  const push = (line: Line) => {
    setLines((previous) => [...previous.slice(-49), line]);
    if (line.role !== "tool") void dataRef.current?.remember?.(line.role, line.text).catch(() => undefined);
  };

  const stop = () => {
    const call = callRef.current;
    if (!call) return;
    cancelAnimationFrame(call.frame);
    call.pc.close();
    call.mic.getTracks().forEach((track) => track.stop());
    void call.audio.close();
    callRef.current = null;
    playerRef.current = null;
    levelsRef.current = { user: 0, assistant: 0 };
    setStatus("idle");
  };

  const newChat = async () => {
    stop();
    setLines([]);
    setError(undefined);
    await dataRef.current?.newChat?.().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)));
  };

  const start = async () => {
    const bridge = dataRef.current;
    if (!bridge?.createSession || !bridge.callTool) return;
    setStatus("connecting");
    setError(undefined);
    try {
      if (!navigator.mediaDevices) throw new Error("Microphone access needs HTTPS or http://localhost (open the UI through an SSH tunnel or put TLS in front of it)");
      const session = await bridge.createSession();
      const audio = new AudioContext();
      const pc = new RTCPeerConnection();
      const player = new Audio();
      player.autoplay = true;
      playerRef.current = player;
      if (canPickOutput && outputId) await player.setSinkId(outputId).catch(() => setOutputId(""));
      pc.ontrack = (event) => {
        const [stream] = event.streams;
        if (!stream) return;
        player.srcObject = stream;
        meter(audio, stream, (level) => { levelsRef.current.assistant = level; });
      };
      // `ideal`, not `exact`: an unplugged device falls back to the default microphone.
      const mic = await navigator.mediaDevices.getUserMedia({ audio: inputId ? { deviceId: inputId } : true });
      refreshDevices(); // device names are only visible after microphone permission
      pc.addTrack(mic.getTracks()[0]!, mic);
      meter(audio, mic, (level) => { levelsRef.current.user = level; });

      const channel = pc.createDataChannel("oai-events");
      channel.onmessage = (message) => void handleEvent(JSON.parse(message.data as string) as Record<string, any>, channel);
      pc.onconnectionstatechange = () => {
        if (["failed", "disconnected", "closed"].includes(pc.connectionState) && callRef.current?.pc === pc) {
          setError(`Connection ${pc.connectionState}`);
          stop();
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const answer = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: { Authorization: `Bearer ${session.clientSecret}`, "Content-Type": "application/sdp" },
      });
      if (!answer.ok) throw new Error(`Realtime call failed (${answer.status}): ${await answer.text()}`);
      await pc.setRemoteDescription({ type: "answer", sdp: await answer.text() });

      callRef.current = { pc, mic, audio, frame: 0 };
      drawLoop(canvasRef.current!, levelsRef, callRef);
      setStatus("live");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      stop();
    }
  };

  const handleEvent = async (event: Record<string, any>, channel: RTCDataChannel) => {
    switch (event.type) {
      case "conversation.item.input_audio_transcription.completed":
        return push({ role: "user", text: String(event.transcript ?? "").trim() });
      case "response.output_audio_transcript.done":
        return push({ role: "assistant", text: String(event.transcript ?? "").trim() });
      case "response.function_call_arguments.done": {
        const name = String(event.name);
        push({ role: "tool", text: `${name}(${event.arguments})` });
        let output: unknown;
        try {
          output = await dataRef.current?.callTool?.(name, JSON.parse(event.arguments || "{}"));
        } catch (caught) {
          output = { success: false, error: { message: caught instanceof Error ? caught.message : String(caught) } };
        }
        channel.send(JSON.stringify({
          type: "conversation.item.create",
          item: { type: "function_call_output", call_id: event.call_id, output: JSON.stringify(output).slice(0, MAX_TOOL_OUTPUT) },
        }));
        channel.send(JSON.stringify({ type: "response.create" }));
        return;
      }
      case "error":
        setError(String(event.error?.message ?? "Realtime error"));
        return;
    }
  };

  useEffect(() => stop, []);

  return (
    <MicrofrontendFrame component={component} title="Live Voice" description="Talk to PLAIOS in real time. The voice model calls every registered capability as a tool.">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(22rem,0.6fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><CardTitle>Voice session</CardTitle><CardDescription>{data?.model} · voice {data?.voice ?? "marin"}</CardDescription></div>
                <Badge variant={status === "live" ? "default" : "secondary"}>{status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-6 py-6">
              <canvas ref={canvasRef} width={320} height={320} className="h-64 w-64" aria-label="Voice activity" />
              {status === "live"
                ? <Button variant="outline" onClick={stop}>End conversation</Button>
                : <Button onClick={() => void start()} disabled={status === "connecting" || data?.configured === false}>{status === "connecting" ? "Connecting…" : "Start talking"}</Button>}
              <div className="grid w-full max-w-md gap-3 sm:grid-cols-2">
                <DevicePicker label="Microphone" kind="audioinput" devices={devices} value={inputId} onChange={setInputId} disabled={status !== "idle"} />
                {canPickOutput ? <DevicePicker label="Speaker" kind="audiooutput" devices={devices} value={outputId} onChange={setOutputId} /> : null}
              </div>
              {typeof navigator !== "undefined" && !navigator.mediaDevices
                ? <p className="text-xs text-muted-foreground">Choosing devices needs HTTPS or http://localhost.</p>
                : hidden && status === "idle" && <Button variant="outline" size="sm" onClick={() => void unlockDevices()}>Allow microphone to list devices</Button>}
              {status === "live" && <p className="text-xs text-muted-foreground">End the conversation to switch microphone; the speaker switches right away.</p>}
              {data?.configured === false && <p className="text-xs text-muted-foreground">Set OPENAI_API_KEY to enable the voice session.</p>}
              {error && <p className="text-xs text-destructive">{error}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><CardTitle>Transcript</CardTitle><CardDescription>What was said and which tools ran.</CardDescription></div>
                <Button variant="outline" size="sm" onClick={() => void newChat()} disabled={status === "connecting" || (lines.length === 0 && status === "idle")}>New chat</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {lines.length === 0 && <p className="text-xs text-muted-foreground">Nothing yet.</p>}
              {lines.map((line, index) => (
                <p key={index} className={`text-sm ${line.role === "tool" ? "font-mono text-xs text-muted-foreground" : line.role === "user" ? "" : "text-primary"}`}>
                  <span className="mr-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{line.role}</span>{line.text}
                </p>
              ))}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <ConfigurationEditor component={component} onSaveConfig={onSaveConfig} />
          <InstanceSummary component={component} />
        </div>
      </div>
    </MicrofrontendFrame>
  );
}

function DevicePicker({ label, kind, devices, value, onChange, disabled }: {
  label: string;
  kind: MediaDeviceKind;
  devices: readonly MediaDeviceInfo[];
  value: string;
  onChange: (deviceId: string) => void;
  disabled?: boolean;
}) {
  // Chrome also lists "default" and "communications" aliases; "System default" covers them.
  const options = devices.filter((device) => device.kind === kind && !["default", "communications", ""].includes(device.deviceId));
  const id = `voice-live-${kind}`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <select id={id} className="h-9 rounded-md border bg-background px-2 text-sm" value={options.some((device) => device.deviceId === value) ? value : ""} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">System default</option>
        {options.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${label} ${index + 1}`}</option>)}
      </select>
    </div>
  );
}

function useStoredChoice(key: string): [string, (value: string) => void] {
  const [value, setValue] = useState(() => (typeof localStorage === "undefined" ? "" : localStorage.getItem(key) ?? ""));
  return [value, (next) => {
    localStorage.setItem(key, next);
    setValue(next);
  }];
}

/** Feeds a smoothed 0..1 loudness level from a stream into `onLevel` every animation frame. */
function meter(audio: AudioContext, stream: MediaStream, onLevel: (level: number) => void): void {
  const analyser = audio.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.6;
  audio.createMediaStreamSource(stream).connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  let level = 0;
  const tick = () => {
    if (audio.state === "closed") return;
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) { const value = (sample - 128) / 128; sum += value * value; }
    level = level * 0.7 + Math.min(1, Math.sqrt(sum / samples.length) * 4) * 0.3;
    onLevel(level);
    requestAnimationFrame(tick);
  };
  tick();
}

/** GPT-voice style blob: a glowing sphere that breathes and jumps with whoever is speaking. */
function drawLoop(
  canvas: HTMLCanvasElement,
  levels: { current: { user: number; assistant: number } },
  call: { current: { frame: number } | null },
): void {
  const context = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const cx = width / 2;
  const cy = height / 2;
  const base = width * 0.22;
  const draw = (time: number) => {
    if (!call.current) return;
    const { user, assistant } = levels.current;
    const level = Math.max(user, assistant);
    const t = time / 1000;
    context.clearRect(0, 0, width, height);

    const radius = base * (1 + level * 0.55);
    context.beginPath();
    for (let step = 0; step <= 128; step += 1) {
      const angle = (step / 128) * Math.PI * 2;
      const wobble = 1
        + 0.05 * Math.sin(3 * angle + t * 1.7)
        + 0.03 * Math.sin(5 * angle - t * 2.3)
        + level * 0.18 * Math.sin(7 * angle + t * 9);
      const r = radius * wobble;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (step === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.closePath();

    // Blue when the assistant speaks, white/cyan while the user talks.
    const speaking = assistant >= user;
    const gradient = context.createRadialGradient(cx - radius * 0.3, cy - radius * 0.35, radius * 0.1, cx, cy, radius * 1.1);
    gradient.addColorStop(0, "rgba(255,255,255,0.98)");
    gradient.addColorStop(0.45, speaking ? "rgba(147,197,253,0.95)" : "rgba(186,230,253,0.95)");
    gradient.addColorStop(1, speaking ? "rgba(37,99,235,0.9)" : "rgba(14,165,233,0.85)");
    context.fillStyle = gradient;
    context.shadowColor = speaking ? "rgba(59,130,246,0.6)" : "rgba(56,189,248,0.5)";
    context.shadowBlur = 30 + level * 50;
    context.fill();
    context.shadowBlur = 0;
    call.current.frame = requestAnimationFrame(draw);
  };
  call.current!.frame = requestAnimationFrame(draw);
}
