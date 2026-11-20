import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "quiet" | "danger";
}

export function Button({
  variant = "secondary",
  type = "button",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={classes("rdps-button", `rdps-button--${variant}`, className)}
    />
  );
}

interface LabeledFieldProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  labelProps?: Omit<
    LabelHTMLAttributes<HTMLLabelElement>,
    "htmlFor" | "children"
  >;
}

export type TextFieldProps = InputHTMLAttributes<HTMLInputElement> &
  LabeledFieldProps;

export function TextField({
  id,
  label,
  hint,
  error,
  labelProps,
  className,
  "aria-describedby": describedBy,
  ...inputProps
}: TextFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="rdps-field">
      <label
        {...labelProps}
        className={classes("rdps-field__label", labelProps?.className)}
        htmlFor={id}
      >
        {label}
      </label>
      {hint ? (
        <div className="rdps-field__hint" id={hintId}>
          {hint}
        </div>
      ) : null}
      <input
        {...inputProps}
        id={id}
        className={classes("rdps-field__control", "rdps-text-field", className)}
        aria-invalid={error ? true : inputProps["aria-invalid"]}
        aria-describedby={joinIds(describedBy, hintId, errorId)}
      />
      {error ? (
        <div className="rdps-field__error" id={errorId} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> &
  LabeledFieldProps;

export function TextArea({
  id,
  label,
  hint,
  error,
  labelProps,
  className,
  "aria-describedby": describedBy,
  ...textareaProps
}: TextAreaProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="rdps-field">
      <label
        {...labelProps}
        className={classes("rdps-field__label", labelProps?.className)}
        htmlFor={id}
      >
        {label}
      </label>
      {hint ? (
        <div className="rdps-field__hint" id={hintId}>
          {hint}
        </div>
      ) : null}
      <textarea
        {...textareaProps}
        id={id}
        className={classes("rdps-field__control", "rdps-text-area", className)}
        aria-invalid={error ? true : textareaProps["aria-invalid"]}
        aria-describedby={joinIds(describedBy, hintId, errorId)}
      />
      {error ? (
        <div className="rdps-field__error" id={errorId} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  as?: "article" | "aside" | "div" | "section";
  children: ReactNode;
}

export function Panel({
  as: Element = "div",
  className,
  ...props
}: PanelProps) {
  return <Element {...props} className={classes("rdps-panel", className)} />;
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      {...props}
      className={classes("rdps-badge", `rdps-badge--${tone}`, className)}
    />
  );
}

export interface PageHeadingProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "title"
> {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  level?: 1 | 2;
}

export function PageHeading({
  title,
  description,
  action,
  level = 1,
  className,
  ...props
}: PageHeadingProps) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <header {...props} className={classes("rdps-page-heading", className)}>
      <div>
        <Heading>{title}</Heading>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? (
        <div className="rdps-page-heading__action">{action}</div>
      ) : null}
    </header>
  );
}

export interface EmptyStateProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "title"
> {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  headingLevel?: 2 | 3 | 4;
}

export function EmptyState({
  title,
  description,
  action,
  headingLevel = 2,
  className,
  ...props
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <section
      {...props}
      className={classes("rdps-empty-state", className)}
      role="status"
    >
      <Heading>{title}</Heading>
      {description ? <p>{description}</p> : null}
      {action ? <div className="rdps-empty-state__action">{action}</div> : null}
    </section>
  );
}

export type ReleaseStatus =
  | "DRAFT"
  | "IN_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "SCHEDULED"
  | "PUBLISHED"
  | "FAILED"
  | "ARCHIVED"
  | "CANCELLED";

const statusPresentation: Record<ReleaseStatus, { label: string; tone: Tone }> =
  {
    DRAFT: { label: "Draft", tone: "neutral" },
    IN_REVIEW: { label: "In review", tone: "warning" },
    APPROVED: { label: "Approved", tone: "success" },
    REJECTED: { label: "Rejected", tone: "danger" },
    SCHEDULED: { label: "Scheduled", tone: "info" },
    PUBLISHED: { label: "Published", tone: "success" },
    FAILED: { label: "Failed", tone: "danger" },
    ARCHIVED: { label: "Archived", tone: "neutral" },
    CANCELLED: { label: "Cancelled", tone: "neutral" },
  };

export interface StatusBadgeProps extends Omit<
  BadgeProps,
  "tone" | "children"
> {
  status: ReleaseStatus;
}

export function StatusBadge({ status, ...props }: StatusBadgeProps) {
  const presentation = statusPresentation[status];
  return (
    <Badge {...props} tone={presentation.tone}>
      {presentation.label}
    </Badge>
  );
}

function classes(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function joinIds(...values: Array<string | undefined>): string | undefined {
  const result = values.filter(Boolean).join(" ");
  return result || undefined;
}
