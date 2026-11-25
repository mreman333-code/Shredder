import type { ReactNode } from 'react'
import type { PrimitiveKind } from '../blend/doc'

interface IconProps {
  size?: number
}

function Svg({ children, size = 17 }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const IconSelect = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3.5 19 12l-6.2 1.2L10 20z" />
  </Svg>
)

export const IconMove = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
  </Svg>
)

export const IconRotate = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.5-5.8" />
    <path d="M20 4v5h-5" />
  </Svg>
)

export const IconScale = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20V8M4 20h12" />
    <rect x="13" y="3.5" width="7" height="7" rx="1" />
  </Svg>
)

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const IconFrame = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" />
    <circle cx="12" cy="12" r="2.5" />
  </Svg>
)

export const IconCube = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2.8 21 7.3v9.4L12 21.2 3 16.7V7.3z" />
    <path d="M3 7.3 12 12l9-4.7M12 12v9.2" />
  </Svg>
)

export const IconSphere = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <ellipse cx="12" cy="12" rx="3.6" ry="8.5" />
    <path d="M3.5 12h17" />
  </Svg>
)

export const IconCylinder = (p: IconProps) => (
  <Svg {...p}>
    <ellipse cx="12" cy="6" rx="6.5" ry="2.6" />
    <path d="M5.5 6v12c0 1.4 2.9 2.6 6.5 2.6s6.5-1.2 6.5-2.6V6" />
  </Svg>
)

export const IconCapsule = (p: IconProps) => (
  <Svg {...p}>
    <rect x="7" y="3" width="10" height="18" rx="5" />
    <path d="M7 12h10" />
  </Svg>
)

export const IconCone = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 20 18.5M12 3 4 18.5" />
    <ellipse cx="12" cy="18.5" rx="8" ry="2.6" />
  </Svg>
)

export const IconTorus = (p: IconProps) => (
  <Svg {...p}>
    <ellipse cx="12" cy="12" rx="9" ry="6" />
    <ellipse cx="12" cy="12" rx="4.5" ry="2.4" />
  </Svg>
)

export const IconPlane = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 15.5 9 6h12l-6 9.5z" />
  </Svg>
)

export const IconGroup = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
    <path d="M10.5 7h3.5v6.5" />
  </Svg>
)

export const IconCharacter = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="5.5" r="2.7" />
    <path d="M12 8.5v6M7 11l5-1.5 5 1.5M12 14.5 9 21M12 14.5 15 21" />
  </Svg>
)

export const IconEye = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.7" />
  </Svg>
)

export const IconEyeOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 3l18 18M10.6 6.1A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-2.2 2.9M6.3 7.2A15.8 15.8 0 0 0 2.5 12S6 18 12 18a9.5 9.5 0 0 0 3.2-.55" />
    <path d="M9.8 9.9a3 3 0 0 0 4.2 4.2" />
  </Svg>
)

export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6.5h16M9 6.5V4h6v2.5M6 6.5l1 14h10l1-14M10 10.5v6M14 10.5v6" />
  </Svg>
)

export const IconCopy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="8" y="8" width="12" height="12" rx="1.5" />
    <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
  </Svg>
)

export const IconUndo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 7 4 12l5 5" />
    <path d="M4 12h9.5a5.5 5.5 0 0 1 0 11H12" />
  </Svg>
)

export const IconRedo = (p: IconProps) => (
  <Svg {...p}>
    <path d="m15 7 5 5-5 5" />
    <path d="M20 12h-9.5a5.5 5.5 0 0 0 0 11H12" />
  </Svg>
)

export const IconSave = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3.5h11L20.5 8v12.5h-17z" />
    <path d="M8 3.5v6h8M8 20.5v-7h8v7" />
  </Svg>
)

export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v12M7 10l5 5 5-5M4 20h16" />
  </Svg>
)

export const IconFolder = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5l2 2.5h8A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z" />
  </Svg>
)

export const IconFile = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v5h5" />
  </Svg>
)

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 5l14 14M19 5 5 19" />
  </Svg>
)

export const IconChevron = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
)

export const IconSnap = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3v8a7 7 0 0 0 14 0V3" />
    <path d="M5 7h4M15 7h4M8 3v4M16 3v4M9 21h6" />
  </Svg>
)

export const IconChat = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5.5h16v11H9.5L4 20.5z" />
    <path d="M8 9.5h8M8 13h5" />
  </Svg>
)

export const IconSend = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z" />
  </Svg>
)

export function KindIcon({ kind, size = 14 }: { kind: PrimitiveKind; size?: number }) {
  switch (kind) {
    case 'sphere':
      return <IconSphere size={size} />
    case 'cylinder':
      return <IconCylinder size={size} />
    case 'capsule':
      return <IconCapsule size={size} />
    case 'cone':
      return <IconCone size={size} />
    case 'torus':
      return <IconTorus size={size} />
    case 'plane':
      return <IconPlane size={size} />
    case 'group':
      return <IconGroup size={size} />
    default:
      return <IconCube size={size} />
  }
}
