import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import MuiButton from "@mui/material/Button";
import OutlinedInput from "@mui/material/OutlinedInput";
import NativeSelect from "@mui/material/NativeSelect";
import Checkbox from "@mui/material/Checkbox";
import Slider from "@mui/material/Slider";
import { ThemeProvider, createTheme } from "@mui/material/styles";

// Labels live outside these inputs; no floating-label legend is needed.
const PlainOutline = React.forwardRef<
  HTMLFieldSetElement,
  { className?: string }
>(function PlainOutline({ className }, ref) {
  return <fieldset aria-hidden="true" className={className} ref={ref} />;
});
const AppearanceContext = createContext({
  textSize: 100,
  setTextSize: (_value: number) => {},
});
export function AppAppearance({ children }: { children: React.ReactNode }) {
  const [textSize, setTextSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("playita-ui-text-size") || 100);
      return [85, 90, 95, 100, 105, 110, 115, 120, 125, 130].includes(saved)
        ? saved
        : 100;
    } catch {
      return 100;
    }
  });
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          primary: { main: "#153e31" },
          secondary: { main: "#17658d" },
          success: { main: "#35623b" },
          background: { default: "#f6f7f1", paper: "#fff" },
          text: { primary: "#263b33", secondary: "#6b786d" },
        },
        typography: {
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          button: { textTransform: "none", fontWeight: 600 },
          htmlFontSize: 16,
        },
        shape: { borderRadius: 10 },
        components: {
          MuiButton: {
            defaultProps: { variant: "outlined", disableElevation: true },
            styleOverrides: {
              root: {
                minHeight: 40,
                minWidth: 0,
                padding: "6px 12px",
                gap: 6,
                textTransform: "none",
              },
            },
          },
          MuiOutlinedInput: {
            defaultProps: { size: "small" },
            styleOverrides: {
              root: { backgroundColor: "#fff", fontSize: "1rem" },
              input: { minWidth: 0 },
            },
          },
          MuiNativeSelect: { styleOverrides: { select: { fontSize: "1rem" } } },
          MuiCheckbox: { defaultProps: { size: "small" } },
        },
      }),
    [],
  );
  useEffect(() => {
    document.documentElement.style.fontSize = `${(16 * textSize) / 100}px`;
    try {
      localStorage.setItem("playita-ui-text-size", String(textSize));
    } catch {}
  }, [textSize]);
  return (
    <AppearanceContext.Provider value={{ textSize, setTextSize }}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </AppearanceContext.Provider>
  );
}
export function TextSizeSettings() {
  const { textSize, setTextSize } = useContext(AppearanceContext);
  return (
    <section className="panel text-size-settings">
      <h2>Tamaño del texto</h2>
      <p>Ajusta la lectura en este dispositivo.</p>
      <Slider
        aria-label="Tamaño del texto"
        min={85}
        max={130}
        step={5}
        value={textSize}
        valueLabelDisplay="auto"
        valueLabelFormat={(v) => `${v}%`}
        onChange={(_event, value) => setTextSize(value as number)}
      />
      <p aria-live="polite">Tamaño actual: {textSize}%</p>
      <Button onClick={() => setTextSize(100)}>Restablecer tamaño</Button>
    </section>
  );
}
export function Button({
  className = "",
  type = "submit",
  ...props
}: Omit<React.ComponentProps<"button">, "color">) {
  const contained = className.split(/\s+/).includes("primary");
  return (
    <MuiButton
      {...props}
      type={type}
      variant={contained ? "contained" : "outlined"}
      className={className}
    />
  );
}
export function Input({
  type = "text",
  clearZero = false,
  ref,
  ...props
}: React.ComponentProps<"input"> & { clearZero?: boolean }) {
  const [emptyPrice, setEmptyPrice] = useState(false);
  if (type === "file" || type === "hidden")
    return <input {...props} type={type} ref={ref} />;
  if (type === "checkbox")
    return (
      <Checkbox
        checked={props.checked}
        defaultChecked={props.defaultChecked}
        onChange={props.onChange}
        disabled={props.disabled}
        required={props.required}
        slotProps={{ input: { ...props, ref } }}
      />
    );
  const {
    onChange,
    value,
    defaultValue,
    disabled,
    required,
    name,
    id,
    className,
    style,
    ...inputProps
  } = props;
  return (
    <OutlinedInput
      slots={{ notchedOutline: PlainOutline }}
      type={type}
      fullWidth
      name={name}
      id={id}
      className={className}
      style={style}
      value={clearZero && emptyPrice && Number(value) === 0 ? "" : value}
      defaultValue={defaultValue}
      disabled={disabled}
      required={required}
      onFocus={(event) => {
        if (clearZero && Number(value) === 0) setEmptyPrice(true);
        inputProps.onFocus?.(event as React.FocusEvent<HTMLInputElement>);
      }}
      onChange={(event) => {
        if (clearZero) setEmptyPrice(event.target.value === "");
        onChange?.(event as React.ChangeEvent<HTMLInputElement>);
      }}
      inputRef={ref}
      inputProps={inputProps}
    />
  );
}
export function Select({
  ref,
  children,
  ...props
}: React.ComponentProps<"select">) {
  const {
    onChange,
    value,
    defaultValue,
    disabled,
    required,
    name,
    id,
    className,
    style,
    ...inputProps
  } = props;
  return (
    <NativeSelect
      fullWidth
      name={name}
      id={id}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
      disabled={disabled}
      required={required}
      className={className}
      style={style}
      input={<OutlinedInput slots={{ notchedOutline: PlainOutline }} />}
      inputRef={ref}
      inputProps={inputProps}
    >
      {children}
    </NativeSelect>
  );
}
export function Textarea({
  ref,
  onChange,
  value,
  defaultValue,
  disabled,
  required,
  name,
  id,
  className,
  style,
  rows = 3,
  ...inputProps
}: React.ComponentProps<"textarea">) {
  return (
    <OutlinedInput
      slots={{ notchedOutline: PlainOutline }}
      fullWidth
      multiline
      minRows={rows}
      name={name}
      id={id}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
      disabled={disabled}
      required={required}
      className={className}
      style={style}
      inputRef={ref}
      inputProps={inputProps}
    />
  );
}
