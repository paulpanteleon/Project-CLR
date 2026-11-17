import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { refusalMessage } from "@/lib/review-log";

// Shown when a shared review log link can't be opened: unknown, expired, withdrawn, meant for
// someone else, or opened by an account with no role (UC2 alternate flow). It never says which
// batch the link was for.
export function SharedRefusal({ result }: { result: string }) {
  return (
    <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
      <Typography variant="h4" component="h1">
        Shared review log
      </Typography>
      <Alert severity="warning" sx={{ width: "100%" }}>
        {refusalMessage(result)}
      </Alert>
      <Button href="/">Go to the home page</Button>
    </Stack>
  );
}
