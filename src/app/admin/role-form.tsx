"use client";

import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";

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

// Lets an admin pick a user type and permission level for one person (US-15).
export function RoleForm({
  userId,
  userType,
  permissionLevel,
  action,
}: {
  userId: string;
  userType: string;
  permissionLevel: string;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" }, mt: 2 }}>
        <TextField select name="userType" label="User type" defaultValue={userType} size="small" fullWidth>
          {Object.entries(USER_TYPE_LABELS).map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </TextField>
        <TextField select name="permissionLevel" label="Permission" defaultValue={permissionLevel} size="small" fullWidth>
          {Object.entries(PERMISSION_LABELS).map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </TextField>
        <Button type="submit" variant="contained" sx={{ minWidth: 140 }}>
          Save role
        </Button>
      </Stack>
    </form>
  );
}
