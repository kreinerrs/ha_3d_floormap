export interface SunPosition {
  azimuth: number;
  elevation: number;
}

export interface Direction3D {
  x: number;
  y: number;
  z: number;
}

export function compassTickRotation(northDegrees: number, index: number): number {
  return (northDegrees - index * 90) * Math.PI / 180;
}

export function sunPosition(state?: { attributes: Record<string, unknown> }): SunPosition | undefined {
  const azimuth = state?.attributes.azimuth;
  const elevation = state?.attributes.elevation;
  if (typeof azimuth !== 'number' || !Number.isFinite(azimuth)
    || typeof elevation !== 'number' || !Number.isFinite(elevation)) return undefined;
  return { azimuth, elevation };
}

export function sunDirection(position: SunPosition, northDegrees: number): Direction3D {
  const relativeAzimuth = (position.azimuth - northDegrees) * Math.PI / 180;
  const elevation = position.elevation * Math.PI / 180;
  const horizontal = Math.cos(elevation);
  return {
    x: Math.sin(relativeAzimuth) * horizontal,
    y: Math.sin(elevation),
    z: -Math.cos(relativeAzimuth) * horizontal,
  };
}
