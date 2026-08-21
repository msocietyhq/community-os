import * as React from "react";
import { cn } from "../../lib/utils";

/**
 * A plain <label> rather than @radix-ui/react-label — the Radix version exists
 * to bridge clicks on non-native controls, and every field here is native.
 */
const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn("text-sm font-medium text-foreground", className)}
    {...props}
  />
));
Label.displayName = "Label";

export { Label };
