import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { DraftForm } from "../draft-form";

// Draft a screening criteria version (S13, US-02). A clinical affairs lead approves it next.
export default function NewCriteriaPage() {
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Draft criteria
      </Typography>
      <Paper elevation={1} sx={{ p: 4, mt: 2 }}>
        <DraftForm />
      </Paper>
    </Container>
  );
}
