// editor-ui 1.2.0 declares types/src/index.d.ts but omits it from its npm tarball.
// These narrow declarations follow the published runtime props used by this app.
declare module "@galacean/editor-ui" {
  import type * as React from "react";
  export const Checkbox: React.ComponentType<{
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
  }>;
  export const ThemeProvider: React.ComponentType<React.PropsWithChildren>;
  export const lightTheme: { className: string };
  export const darkTheme: { className: string };
  export const Button: React.ComponentType<
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "size"> & {
      variant?: "default" | "primary" | "secondary" | "subtle" | "ghost";
      size?: "xs" | "sm" | "md" | "lg";
      loading?: boolean;
    }
  >;
  export const Input: React.ComponentType<
    Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & {
      size?: "sm" | "md";
    }
  >;
  export const InputNumber: React.ComponentType<{
    value?: number;
    onValueChange?: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    dragStep?: number;
    disabled?: boolean;
    size?: "sm" | "md";
    "aria-label"?: string;
  }>;
  export const Select: React.ComponentType<
    React.PropsWithChildren<{
      value?: string;
      onValueChange?: (value: string) => void;
      disabled?: boolean;
      placeholder?: string;
      id?: string;
      triggerCss?: Record<string, unknown>;
    }>
  >;
  export const SelectItem: React.ComponentType<
    React.PropsWithChildren<{ value: string; disabled?: boolean }>
  >;
  export const SegmentControl: React.ComponentType<
    React.PropsWithChildren<{
      value: string;
      onValueChange: (value: string) => void;
      "aria-label"?: string;
    }>
  >;
  export const SegmentControlItem: React.ComponentType<
    React.PropsWithChildren<{ value: string }>
  >;
  export const Dialog: React.ComponentType<
    React.PropsWithChildren<{
      open: boolean;
      onOpenChange: (open: boolean) => void;
      closable?: boolean;
      css?: Record<string, unknown>;
      className?: string;
    }>
  >;
  export const Textarea: React.ComponentType<
    React.TextareaHTMLAttributes<HTMLTextAreaElement>
  >;
  export const Slider: React.ComponentType<{
    value: number[];
    onValueChange?: (value: number[]) => void;
    onValueCommit?: (value: number[]) => void;
    min?: number;
    max?: number;
    step?: number;
    compact?: boolean;
    disabled?: boolean;
    "aria-label"?: string;
  }>;
  export const BezierCurveEditor: React.ComponentType<{
    width: number;
    height: number;
    points: { x: number; y: number }[];
    onPointsChange: (points: { x: number; y: number }[]) => void;
    algo?: "linear" | "bezier";
    zoomable?: boolean;
    draggable?: boolean;
  }>;
}
