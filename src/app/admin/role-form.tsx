"use client";

import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { PERMISSION_LABELS, USER_TYPE_LABELS } from "@/lib/roles";

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
        {/* The key remounts the select when the saved value changes, so defaultValue is not changed on a mounted select. */}
        <TextField key={userType} select name="userType" label="User type" defaultValue={userType} size="small" fullWidth>
          {Object.entries(USER_TYPE_LABELS).map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </TextField>
        <TextField key={permissionLevel} select name="permissionLevel" label="Permission" defaultValue={permissionLevel} size="small" fullWidth>
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
