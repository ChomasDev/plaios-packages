import type { OpenUIComponentSpec } from "@agent-os/microfrontend";

/** Shared by the backend (prompt) and the web module (renderer) so the model and the browser agree on the component. */
export const CRONJOB_OPENUI: OpenUIComponentSpec = {
  name: "CronjobList",
  description: "The user's scheduled jobs (cronjobs) as an interactive list with expand, pause, resume, remove and edit. Use it whenever the user asks about their schedules or cronjobs instead of describing them in a Table.",
  props: [{ name: "filter", type: "string", optional: true, description: "Only show jobs whose name contains this text; omit to show all jobs." }],
};
