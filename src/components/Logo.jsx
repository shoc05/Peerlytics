import React, { useState } from 'react';
import { LOGO_SRC, LOGO_DARK_SRC, LOGO_MARK_SRC, LOGO_MARK_DARK_SRC, GRADIENT } from '../constants/theme';

/**
 * @param {'banner' | 'mark'} variant — banner = wide wordmark; mark = compact square
 */
export default function Logo({
  variant = 'banner',
  darkMode = false,
  width,
  height,
  style,
  className,
}) {
  const [imgError, setImgError] = useState(false);
  const isMark = variant === 'mark';
  // Mark variant uses the icon-only image; if that file isn't present yet it falls
  // back to the wordmark logo (handled in onError), then to the text tile.
  const [markFallback, setMarkFallback] = useState(false);
  const wordmarkSrc = darkMode ? LOGO_DARK_SRC : LOGO_SRC;
  const markSrc = darkMode ? LOGO_MARK_DARK_SRC : LOGO_MARK_SRC;
  const src = isMark && !markFallback ? markSrc : wordmarkSrc;

  const isBanner = variant === 'banner';
  const w = width ?? (isBanner ? 240 : 40);
  const h = height ?? (isBanner ? 64 : 40);

  if (imgError) {
    return (
      <div
        className={className}
        style={{
          width: w,
          height: h,
          background: GRADIENT,
          borderRadius: isBanner ? 8 : 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: isBanner ? 18 : h * 0.45,
          fontWeight: 'bold',
          color: 'white',
          flexShrink: 0,
          ...style,
        }}
        aria-label="Peerlytics"
      >
        Peerlytics
      </div>
    );
  }

  // width="auto" lets the wordmark scale by height only (fills the header height).
  const autoWidth = w === 'auto';

  return (
    <img
      className={className}
      src={src}
      alt="Peerlytics"
      height={h}
      onError={() => {
        // Icon-only file missing → try the wordmark; if that also fails → text tile.
        if (isMark && !markFallback) setMarkFallback(true);
        else setImgError(true);
      }}
      style={{
        width: autoWidth ? 'auto' : w,
        height: h,
        objectFit: 'contain',
        objectPosition: 'left center',
        display: 'block',
        flexShrink: 0,
        ...style,
      }}
    />
  );
}
