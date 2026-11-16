// Display labels for user types and permission levels (US-15). A plain module, so server and client
// components both get the real values. A "use client" module's exports are only references on the server.

export const USER_TYPE_LABELS: Record<string, string> = {
  medical_writer: "Medical writer",
  clinician_reviewer: "Clinician reviewer",
  clinical_affairs_lead: "Clinical affairs lead",
};

export const PERMISSION_LABELS: Record<string, string> = {
  read_only: "Read-only",
  reviewer: "Reviewer",
  owner: "Owner",
};
