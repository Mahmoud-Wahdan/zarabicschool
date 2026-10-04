function GeometricPattern() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full opacity-5"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id="landing-geo" width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M24 2 L46 24 L24 46 L2 24 Z" fill="none" stroke="currentColor" strokeWidth="1" />
          <circle cx="24" cy="24" r="4" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#landing-geo)" />
    </svg>
  );
}

export default GeometricPattern;
