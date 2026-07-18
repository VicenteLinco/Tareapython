import { useState } from "react";
import { Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { getImageUrl } from "@/lib/utils";

const SIZE_MAP = {
  sm: { px: 28, radius: "rounded-md", icon: 14 },
  md: { px: 40, radius: "rounded-lg", icon: 20 },
  lg: { px: 72, radius: "rounded-xl", icon: 32 },
} as const;

interface ProductoImageProps {
  src?: string | null;
  size?: keyof typeof SIZE_MAP;
  className?: string;
}

export function ProductoImage({
  src,
  size = "md",
  className,
}: ProductoImageProps) {
  const [imgError, setImgError] = useState(false);
  const { px, radius, icon } = SIZE_MAP[size];

  const showFallback = !src || imgError;

  return (
    <div
      className={cn(
        "flex-shrink-0 flex items-center justify-center bg-base-200",
        radius,
        className,
      )}
      style={{ width: px, height: px }}
    >
      {showFallback ? (
        <Package
          style={{ width: icon, height: icon }}
          className="text-base-content opacity-30"
        />
      ) : (
        <img
          src={getImageUrl(src)}
          alt=""
          className={cn("object-cover", radius)}
          style={{ width: px, height: px }}
          onError={() => setImgError(true)}
        />
      )}
    </div>
  );
}
