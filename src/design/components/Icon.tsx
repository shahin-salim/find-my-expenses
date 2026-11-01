import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from '../index';

export type IconName =
  | 'message' | 'location' | 'bell' | 'lock' | 'check' | 'chevron-left'
  | 'chevron-right' | 'chevron-down' | 'plus' | 'search' | 'filter'
  | 'home' | 'list' | 'close' | 'copy' | 'edit' | 'alert'
  // Category icons
  | 'bowl' | 'basket' | 'bus' | 'bag' | 'bolt' | 'swap' | 'dots'
  // The category-create picker set
  | 'circle' | 'triangle' | 'square' | 'pin' | 'star' | 'briefcase'
  // Health, fuel and insurance
  | 'cross' | 'fuel' | 'shield' | 'person' | 'lend' | 'bike' | 'calendar';

const ICON_NAMES: readonly IconName[] = [
  'message', 'location', 'bell', 'lock', 'check', 'chevron-left',
  'chevron-right', 'chevron-down', 'plus', 'search', 'filter',
  'home', 'list', 'close', 'copy', 'edit', 'alert',
  'bowl', 'basket', 'bus', 'bag', 'bolt', 'swap', 'dots',
  'circle', 'triangle', 'square', 'pin', 'star', 'briefcase',
  'cross', 'fuel', 'shield', 'person', 'lend', 'bike', 'calendar',
];

/**
 * The icon a stored string names, or a plain circle when the build does not
 * draw it.
 *
 * Section 8.2 stores the icon as a key in a TEXT column, so the value can
 * outlive the set that drew it — a category made on a later release and
 * opened on an earlier one, or a key renamed. Falling back is what keeps
 * that from being a missing icon in the middle of a list.
 */
export function iconName(value: string): IconName {
  return ICON_NAMES.includes(value as IconName) ? (value as IconName) : 'circle';
}

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

/**
 * Stroked line icons, drawn on a 24-unit grid so every one lines up optically
 * at the same size.
 */
export function Icon({ name, size = 20, color, strokeWidth = 1.8 }: IconProps) {
  const theme = useTheme();
  const stroke = color ?? theme.color.textPrimary;
  const common = {
    stroke,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {renderPaths(name, common, stroke)}
    </Svg>
  );
}

function renderPaths(
  name: IconName,
  common: Record<string, unknown>,
  stroke: string,
): React.ReactNode {
  switch (name) {
    case 'message':
      return <Path {...common} d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5v-3.5A2.5 2.5 0 0 1 4 13.5z" />;
    case 'location':
    case 'pin':
      return (
        <>
          <Path {...common} d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" />
          <Circle {...common} cx={12} cy={10} r={2.6} />
        </>
      );
    case 'bell':
      return (
        <>
          <Path {...common} d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5s1.5-1.5 1.5-5.5z" />
          <Path {...common} d="M10 19a2 2 0 0 0 4 0" />
        </>
      );
    case 'calendar':
      return (
        <>
          <Rect {...common} x={3.5} y={5.5} width={17} height={15} rx={2.5} />
          {/* The rule under the header and the two hangers, which is what
              reads as a calendar rather than as a framed box. */}
          <Path {...common} d="M3.5 10.5h17M8.5 3.5v4M15.5 3.5v4" />
        </>
      );
    case 'lock':
      return (
        <>
          <Rect {...common} x={5} y={10.5} width={14} height={9.5} rx={2.5} />
          <Path {...common} d="M8.5 10.5V8a3.5 3.5 0 1 1 7 0v2.5" />
        </>
      );
    case 'check':
      return <Path {...common} d="M5 12.8 9.6 17 19 7.2" />;
    case 'chevron-left':
      return <Path {...common} d="M15 5 8 12l7 7" />;
    case 'chevron-right':
      return <Path {...common} d="m9 5 7 7-7 7" />;
    case 'chevron-down':
      return <Path {...common} d="m5 9 7 7 7-7" />;
    case 'plus':
      return <Path {...common} d="M12 5v14M5 12h14" />;
    case 'search':
      return (
        <>
          <Circle {...common} cx={11} cy={11} r={6.2} />
          <Path {...common} d="m15.6 15.6 3.9 3.9" />
        </>
      );
    case 'filter':
      return <Path {...common} d="M4 7h16M7 12h10M10 17h4" />;
    case 'home':
      return <Path {...common} d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-5.5h-6V20H5a1 1 0 0 1-1-1z" />;
    case 'list':
      return <Path {...common} d="M4 7h16M4 12h16M4 17h16" />;
    case 'close':
      return <Path {...common} d="M6 6l12 12M18 6 6 18" />;
    case 'copy':
      return (
        <>
          <Rect {...common} x={9} y={9} width={11} height={11} rx={2.5} />
          <Path {...common} d="M15 6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15" />
        </>
      );
    case 'edit':
      return <Path {...common} d="M16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1 1-4z" />;
    case 'alert':
      return (
        <>
          <Circle {...common} cx={12} cy={12} r={8.2} />
          <Path {...common} d="M12 7.8v5M12 16.1h.01" />
        </>
      );
    case 'bowl':
      return (
        <>
          <Path {...common} d="M4 11h16a8 8 0 0 1-8 8 8 8 0 0 1-8-8z" />
          <Path {...common} d="M9 7.5c0-1.5 1.5-1.5 1.5-3M13.5 7.5c0-1.5 1.5-1.5 1.5-3" />
        </>
      );
    case 'basket':
      return (
        <>
          <Path {...common} d="M4 9h16l-1.6 9.2a2 2 0 0 1-2 1.8H7.6a2 2 0 0 1-2-1.8z" />
          <Path {...common} d="m8.5 9 2-5M15.5 9l-2-5" />
        </>
      );
    case 'bus':
      return (
        <>
          <Rect {...common} x={4.5} y={4.5} width={15} height={12} rx={2.5} />
          <Path {...common} d="M4.5 11h15M7.5 20v-3M16.5 20v-3" />
        </>
      );
    case 'bag':
      return (
        <>
          <Path {...common} d="M5.5 8h13l-1 11.2a2 2 0 0 1-2 1.8H8.5a2 2 0 0 1-2-1.8z" />
          <Path {...common} d="M9 8V6.5a3 3 0 1 1 6 0V8" />
        </>
      );
    case 'bike':
      // Two wheels and the frame between them.
      return (
        <>
          <Circle cx={5.5} cy={17} r={3.5} {...common} />
          <Circle cx={18.5} cy={17} r={3.5} {...common} />
          <Path {...common} d="M5.5 17 10 8h4l4.5 9M9 8h6" />
        </>
      );
    case 'lend':
      // Out, and round again: the arrow leaves and the loop brings it back.
      return (
        <>
          <Path {...common} d="M21 12a9 9 0 1 1-2.6-6.4" />
          <Path {...common} d="M21 4v5h-5" />
        </>
      );
    case 'person':
      return (
        <>
          <Circle cx={12} cy={8} r={3.6} {...common} />
          <Path {...common} d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
        </>
      );
    case 'cross':
      return <Path {...common} d="M10 3h4v6h6v4h-6v6h-4v-6H4V9h6z" />;
    case 'fuel':
      // A pump: the body, its nozzle arm, and the filler window.
      return (
        <>
          <Path {...common} d="M4 20V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v15" />
          <Path {...common} d="M3 20h11" />
          <Path {...common} d="M6 7h5v4H6z" />
          <Path {...common} d="M13 9h3a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0v-7l-2.5-2.5" />
        </>
      );
    case 'shield':
      return <Path {...common} d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" />;
    case 'bolt':
      return <Path {...common} d="M13.5 3 5.5 13.5H11l-.5 7.5 8-10.5H13z" />;
    case 'swap':
      return <Path {...common} d="M4 9h13l-3.5-3.5M20 15H7l3.5 3.5" />;
    case 'dots':
      return (
        <>
          <Circle cx={6} cy={12} r={1.8} fill={stroke} />
          <Circle cx={12} cy={12} r={1.8} fill={stroke} />
          <Circle cx={18} cy={12} r={1.8} fill={stroke} />
        </>
      );
    case 'circle':
      return <Circle {...common} cx={12} cy={12} r={7} />;
    case 'triangle':
      return <Path {...common} d="M12 5.5 20 18.5H4z" />;
    case 'square':
      return <Rect {...common} x={5.5} y={5.5} width={13} height={13} rx={2.5} />;
    case 'star':
      return <Path {...common} d="m12 4 2.5 5.3 5.5.7-4 4 1 5.6L12 17l-5 2.6 1-5.6-4-4 5.5-.7z" />;
    case 'briefcase':
      return (
        <>
          <Rect {...common} x={3.5} y={7.5} width={17} height={11} rx={2.5} />
          <Path {...common} d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" />
        </>
      );
    default:
      return <Circle {...common} cx={12} cy={12} r={7} />;
  }
}
