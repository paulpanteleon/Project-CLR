import Button from "@mui/material/Button";
import { signOut } from "./actions";

// Lets a signed-in user leave without finishing the authenticator step.
export function SignOut() {
  return (
    <form action={signOut}>
      <Button type="submit" variant="text" color="inherit" sx={{ mt: 2 }}>
        Sign out
      </Button>
    </form>
  );
}
