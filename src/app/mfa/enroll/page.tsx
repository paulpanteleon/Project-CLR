import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import { SignOut } from "../sign-out";
import { EnrollFlow } from "./enroll-flow";

// Multi-factor set-up page (S-1). Rendering this page changes nothing. The authenticator
// is created only when the user presses "Start set-up".
export default function EnrollPage() {
  return (
    <Container maxWidth="xs" sx={{ py: 8 }}>
      <Paper elevation={1} sx={{ p: 4 }}>
        <EnrollFlow />
        <SignOut />
      </Paper>
    </Container>
  );
}
