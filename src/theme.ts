import { createTheme } from "@mui/material/styles";

// The one place colours, type, and spacing are set for the app (see docs/architecture/plan.md).
// Colours are placeholders until the design system is agreed.
const theme = createTheme({
  palette: {
    primary: { main: "#1d4f6b" },
    secondary: { main: "#5b6b73" },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: "var(--font-geist-sans), Arial, Helvetica, sans-serif",
  },
});

export default theme;
