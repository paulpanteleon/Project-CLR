import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PERMISSION_LABELS, USER_TYPE_LABELS } from "@/lib/roles";
import { addBatchMember } from "../../actions";
import { RemoveMemberButton } from "./remove-member-button";

type Member = {
  user_id: string;
  email: string;
  user_type: string | null;
  permission_level: string | null;
  is_creator: boolean;
};

// The people on a batch (US-14, ADR-0016). Every member sees the list. The batch's creator, and an
// owner on the batch, can add people by email and remove anyone but the creator, after confirming.
export async function MembersSection({ batchId }: { batchId: string }) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const [{ data: rows }, { data: canManage }] = await Promise.all([
    supabase.rpc("batch_member_details", { p_batch_id: batchId }),
    supabase.rpc("can_manage_batch", { p_batch_id: batchId }),
  ]);
  const members = (rows ?? []) as Member[];

  return (
    <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
      <Typography variant="h6" component="h2" gutterBottom>
        People on this batch
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Only these people can open the batch. What each can do depends on their permission level.
      </Typography>

      <Stack spacing={1.5} sx={{ mb: canManage ? 3 : 0 }}>
        {members.map((member) => (
          <Stack
            key={member.user_id}
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
          >
            <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
                {member.email}
              </Typography>
              {member.user_type && (
                <Chip size="small" label={USER_TYPE_LABELS[member.user_type] ?? member.user_type} />
              )}
              {member.permission_level && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={PERMISSION_LABELS[member.permission_level] ?? member.permission_level}
                />
              )}
              {member.is_creator && <Chip size="small" color="primary" label="Created the batch" />}
            </Stack>
            {canManage && !member.is_creator && (
              <RemoveMemberButton batchId={batchId} userId={member.user_id} email={member.email} />
            )}
          </Stack>
        ))}
      </Stack>

      {canManage && (
        <form action={addBatchMember}>
          <input type="hidden" name="batchId" value={batchId} />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "flex-start" } }}>
            <TextField
              name="email"
              type="email"
              label="Add a person by email"
              size="small"
              fullWidth
              required
              helperText="They need an account with a role. An admin sets roles on Users and roles."
            />
            <Button type="submit" variant="contained" sx={{ minWidth: 100 }}>
              Add
            </Button>
          </Stack>
        </form>
      )}
    </Paper>
  );
}
