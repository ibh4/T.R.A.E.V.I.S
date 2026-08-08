import traeLogo from "../../../../assets/trae-color.svg";
import type { ImgHTMLAttributes } from "react";

interface BrandLogoProps {
  compact?: boolean;
  inverse?: boolean;
}

interface BrandMarkIconProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height"> {
  size?: number;
}

export function BrandMarkIcon({ size, className = "", alt = "", style, ...props }: BrandMarkIconProps) {
  return (
    <img
      {...props}
      className={`brand-mark-icon ${className}`.trim()}
      src={traeLogo}
      alt={alt}
      data-brand-mark="true"
      style={size ? { ...style, width: size, height: size } : style}
    />
  );
}

export function BrandLogo({ compact = false, inverse = false }: BrandLogoProps) {
  return (
    <span className={`brand-logo ${compact ? "brand-logo--compact" : ""}`}>
      <span className="brand-logo__mark">
        <img src={traeLogo} alt="TRAE" />
      </span>
      {!compact && (
        <span className="brand-logo__copy">
          <strong className={inverse ? "text-ink" : ""}>T.R.A.E.V.I.S.</strong>
          <span>TRAE EMBODIED INTELLIGENCE SYSTEM</span>
        </span>
      )}
    </span>
  );
}
