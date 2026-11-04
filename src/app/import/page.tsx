import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { ImportForm } from "./import-form";

// Import PubMed batch (S02).
export default function ImportPage() {
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Import PubMed batch
      </Typography>
      <Paper elevation={1} sx={{ p: 4, mt: 2 }}>
        <ImportForm />
      </Paper>
    </Container>
  );
}
