import AppKit
import Darwin
import SwiftUI

@main
struct AgentOsRemoteApp: App {
    var body: some Scene {
        WindowGroup {
            PairingView()
                .frame(minWidth: 640, minHeight: 720)
        }
        .windowResizability(.contentMinSize)
    }
}

struct PairingView: View {
    @State private var publicKey = ""
    @State private var status = "Paste the server public key, then enable Remote Login."
    @State private var pairingJSON = Pairing.current.json
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Agent OS Remote")
                .font(.largeTitle.weight(.semibold))
            Text("This Mac becomes a paired computer the villa can control over SSH. The private key stays on the server.")
                .foregroundStyle(.secondary)

            identity

            VStack(alignment: .leading, spacing: 8) {
                Text("Server public key")
                    .font(.headline)
                TextEditor(text: $publicKey)
                    .font(.system(.body, design: .monospaced))
                    .frame(minHeight: 120)
                    .border(Color.secondary.opacity(0.3))
            }

            HStack {
                Button("Enable Remote Login") { run(Pairing.enableRemoteLogin) }
                Button("Install key + helper") { run(install) }
                    .disabled(publicKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button("Copy pairing JSON") { copy(pairingJSON) }
            }
            .disabled(busy)

            Text(status)
                .font(.callout)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 8) {
                Text("Add this device on the server")
                    .font(.headline)
                Text(pairingJSON)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(8)
                    .background(Color.secondary.opacity(0.08))
            }
            Spacer()
        }
        .padding(24)
    }

    private var identity: some View {
        Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
            row("Computer", Pairing.current.name)
            row("User", Pairing.current.user)
            row("Addresses", Pairing.current.addresses.joined(separator: ", "))
        }
        .padding(12)
        .background(Color.secondary.opacity(0.08))
    }

    private func row(_ label: String, _ value: String) -> some View {
        GridRow {
            Text(label).foregroundStyle(.secondary)
            Text(value).font(.body.monospaced())
        }
    }

    private func run(_ work: @escaping () throws -> String) {
        busy = true
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let message = try work()
                DispatchQueue.main.async {
                    pairingJSON = Pairing.current.json
                    status = message
                    busy = false
                }
            } catch {
                DispatchQueue.main.async {
                    status = error.localizedDescription
                    busy = false
                }
            }
        }
    }

    private func install() throws -> String {
        let login = try Pairing.enableRemoteLogin()
        let key = try Pairing.installPublicKey(publicKey)
        let helper = try Pairing.installHelper()
        return [login, key, helper].joined(separator: " ")
    }

    private func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        status = "Pairing JSON copied."
    }
}

enum Pairing {
    static var current: Identity {
        Identity(
            name: Host.current().localizedName ?? "Mac",
            user: NSUserName(),
            addresses: addresses()
        )
    }

    static func enableRemoteLogin() throws -> String {
        try runAdmin("systemsetup -f -setremotelogin on")
        return "Remote Login is on."
    }

    static func installPublicKey(_ raw: String) throws -> String {
        let key = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard key.hasPrefix("ssh-") else { throw PairingError.invalidKey }
        let ssh = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".ssh")
        try FileManager.default.createDirectory(at: ssh, withIntermediateDirectories: true)
        let authorized = ssh.appendingPathComponent("authorized_keys")
        var existing = (try? String(contentsOf: authorized, encoding: .utf8)) ?? ""
        if !existing.contains(key) {
            if !existing.isEmpty && !existing.hasSuffix("\n") { existing += "\n" }
            existing += key + "\n"
            try existing.write(to: authorized, atomically: true, encoding: .utf8)
        }
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: authorized.path)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: ssh.path)
        return "Public key installed."
    }

    static func installHelper() throws -> String {
        let root = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".agent-os-remote/bin", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let url = root.appendingPathComponent("agent-os-remote")
        try helperScript.write(to: url, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
        return "Helper installed at ~/.agent-os-remote/bin/agent-os-remote."
    }

    private static func addresses() -> [String] {
        var addresses: [String] = []
        var iterator: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&iterator) == 0, let first = iterator else { return [] }
        defer { freeifaddrs(first) }
        var pointer = iterator
        while let current = pointer {
            let family = current.pointee.ifa_addr.pointee.sa_family
            if family == UInt8(AF_INET) {
                var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                getnameinfo(current.pointee.ifa_addr, socklen_t(current.pointee.ifa_addr.pointee.sa_len), &hostname, socklen_t(hostname.count), nil, 0, NI_NUMERICHOST)
                let ip = String(cString: hostname)
                if ip != "127.0.0.1" { addresses.append(ip) }
            }
            pointer = current.pointee.ifa_next
        }
        return addresses
    }

    private static func runAdmin(_ command: String) throws {
        let script = """
        do shell script "\(command)" with administrator privileges
        """
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]
        let pipe = Pipe()
        process.standardError = pipe
        try process.run()
        process.waitUntilExit()
        if process.terminationStatus != 0 {
            let error = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "failed"
            throw PairingError.admin(error)
        }
    }
}

struct Identity {
    let name: String
    let user: String
    let addresses: [String]

    var json: String {
        let host = addresses.first ?? "IP_ADDRESS"
        return """
        {
          "id": "\(slug)",
          "name": "\(name)",
          "host": "\(host)",
          "user": "\(user)",
          "port": 22,
          "os": "macos",
          "privateKeyPath": "/home/USER/.ssh/agent-os-mac"
        }
        """
    }

    private var slug: String {
        name.lowercased().replacingOccurrences(of: " ", with: "-")
    }
}

enum PairingError: LocalizedError {
    case invalidKey
    case admin(String)
    var errorDescription: String? {
        switch self {
        case .invalidKey: return "Paste a public key that starts with ssh-ed25519 or ssh-rsa."
        case .admin(let message): return message
        }
    }
}

private let helperScript = """
#!/bin/zsh
set -euo pipefail
command="${1:-status}"
shift || true
case "$command" in
  status) print -- "name=$(scutil --get ComputerName 2>/dev/null || hostname)"; print -- "user=$(id -un)"; print -- "host=$(hostname)"; print -- "os=$(sw_vers -productVersion 2>/dev/null || echo unknown)"; uptime ;;
  open) open -a "${1:?app name required}" ;;
  quit) osascript -e "tell application \\"${1:?app name required}\\" to quit" ;;
  notify) osascript -e "display notification \\"${1:-Agent OS}\\" with title \\"Agent OS\\"" ;;
  lock|sleep-display) pmset displaysleepnow ;;
  wake) caffeinate -u -t 2 ;;
  volume) osascript -e "set volume output volume ${1:?volume 0-100 required}" ;;
  say) say "${1:?text required}" ;;
  screenshot) path="${1:-/tmp/agent-os-screenshot.png}"; screencapture -x "$path"; print -- "$path" ;;
  *) print -u2 "Usage: agent-os-remote status|open|quit|notify|lock|wake|volume|say|screenshot"; exit 1 ;;
esac
"""
