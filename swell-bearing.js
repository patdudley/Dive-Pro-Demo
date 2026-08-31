/** Open-Meteo / NDBC swell direction is meteorological coming-from. */
export function swellSourceBearingToTravelBearing(sourceBearing) {
  return (Number(sourceBearing) + 180) % 360;
}

export function normalizeBearingDeg(deg) {
  return ((Number(deg) % 360) + 360) % 360;
}

export function angularDistanceDeg(a, b) {
  return Math.abs(((Number(a) - Number(b) + 540) % 360) - 180);
}

/**
 * West-coast CA (ocean west, land east): arrow heads stay west of true north
 * (NW–NNW), never NE/E and never south into the ocean.
 *
 * travel = comingFrom + 180
 * if travel in (0, 90] (east of north): mirror across north → 360 - travel
 * if travel in (90, 270) (south / open ocean): fold to the northern half,
 *   then mirror again if that landed in the NE.
 * if travel is exact 0° N: nudge to 350° NNW so it cannot read as northeast.
 */
export function swellTravelBearingWestOfNorth(sourceBearing) {
  let travel = swellSourceBearingToTravelBearing(normalizeBearingDeg(sourceBearing));
  if (travel > 0 && travel <= 90) {
    travel = (360 - travel) % 360;
  }
  if (travel > 90 && travel < 270) {
    travel = (180 - travel + 360) % 360;
    if (travel > 0 && travel <= 90) {
      travel = (360 - travel) % 360;
    }
  }
  if (!(travel > 270 && travel <= 360)) return 350;
  return travel;
}

/**
 * Anacapa is not a west-facing mainland beach. Still never invent an
 * east-going or due-south shaft into the Channel.
 */
export function swellTravelBearingAnacapa(sourceBearing) {
  return swellTravelBearingWestOfNorth(sourceBearing);
}

export function swellSpotUsesWestOfNorthClamp() {
  return true;
}

/** Drawn travel heading for a CA spot. Does not change the printed coming-from. */
export function swellTravelBearingForSpot(sourceBearing) {
  return swellTravelBearingWestOfNorth(sourceBearing);
}

export function isTravelWestOfNorth(deg) {
  const t = normalizeBearingDeg(deg);
  return t > 270 && t <= 360;
}

export function isForbiddenWestCoastShaft(deg) {
  const t = normalizeBearingDeg(deg);
  if (t > 0 && t <= 90) return true;
  if (t >= 90 && t <= 270) return true;
  return false;
}

/**
 * CSS/SVG rotate for an east-pointing shaft (local +X / 0°).
 * Compass 0° is north, clockwise; compensate exactly once with +270.
 * Do not add another 180° here — travel already did that.
 */
export function swellTravelBearingToArrowRotateDeg(travelBearing) {
  return (Number(travelBearing) + 270) % 360;
}

export const SWELL_ROSE_CX = 117.5;
export const SWELL_ROSE_CY = 117.5;
export const SWELL_HEAD_HALF_RATIO = 0.62;
export const SWELL_HEAD_STROKE = 1.4;
export const SWELL_SHAFT_OUTLINE = 1.4;

/** Desktop SVG units (1:1 with CSS px at the 235px rose). Same SVG layout on mobile. */
export const SWELL_MIN_HEAD_CENTER_GAP = 40;
export const SWELL_OUTLINE_GAP = 6;
export const SWELL_MAX_PERP_OFFSET = 24;
export const SWELL_MAX_BISECTOR_OFFSET = 20;

export function defaultSwellArrowSpec(role) {
  if (role === "secondary") {
    return {
      length: 122,
      strokeWidth: 5.2,
      headSize: 17,
      hubGap: 24,
      color: "#ee13ba",
    };
  }
  return {
    length: 115,
    strokeWidth: 8.6,
    headSize: 20,
    hubGap: 18,
    color: "#13baee",
  };
}

function degToRad(deg) {
  return (Number(deg) * Math.PI) / 180;
}

function rotateAround(x, y, cx, cy, deg) {
  const t = degToRad(deg);
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const dx = x - cx;
  const dy = y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

function travelUnit(travelDeg) {
  const t = degToRad(travelDeg);
  return { x: Math.sin(t), y: -Math.cos(t) };
}

function unitBisector(travelA, travelB) {
  const a = travelUnit(travelA);
  const b = travelUnit(travelB);
  const x = a.x + b.x;
  const y = a.y + b.y;
  const mag = Math.hypot(x, y);
  if (mag < 1e-6) {
    return { x: -a.y, y: a.x, degenerate: true };
  }
  return { x: x / mag, y: y / mag, degenerate: false };
}

export function swellArrowWorldGeometry(spec) {
  const sourceBearing = Number(spec.sourceBearing);
  const travelBearing = spec.spot || spec.spotSlug || spec.clampTravel
    ? swellTravelBearingForSpot(sourceBearing, spec.spot || { slug: spec.spotSlug })
    : swellSourceBearingToTravelBearing(sourceBearing);
  const rotateDeg = swellTravelBearingToArrowRotateDeg(travelBearing);
  const headSize = Number(spec.headSize);
  const hubGap = Number.isFinite(Number(spec.hubGap)) ? Number(spec.hubGap) : 14;
  const offsetPx = Number(spec.offsetPx || 0);
  const worldX = Number(spec.worldX || 0);
  const worldY = Number(spec.worldY || 0);
  const strokeWidth = Number(spec.strokeWidth);
  const length = Number(spec.length);
  const y = SWELL_ROSE_CY + offsetPx;
  const tailX = SWELL_ROSE_CX - length;
  const tipX = SWELL_ROSE_CX + hubGap + headSize;
  const baseX = tipX - headSize;
  const headHalf = headSize * SWELL_HEAD_HALF_RATIO;
  const mapPt = (x, ly) => {
    const rotated = rotateAround(x, ly, SWELL_ROSE_CX, SWELL_ROSE_CY, rotateDeg);
    return { x: rotated.x + worldX, y: rotated.y + worldY };
  };
  const tip = mapPt(tipX, y);
  const baseA = mapPt(baseX, y - headHalf);
  const baseB = mapPt(baseX, y + headHalf);
  const tail = mapPt(tailX, y);
  const baseMid = mapPt(baseX, y);
  return {
    sourceBearing,
    travelBearing,
    rotateDeg,
    headSize,
    tip,
    head: [tip, baseA, baseB],
    headCenter: {
      x: (tip.x + baseA.x + baseB.x) / 3,
      y: (tip.y + baseA.y + baseB.y) / 3,
    },
    shaft: {
      a: tail,
      b: baseMid,
      radius: (strokeWidth + SWELL_SHAFT_OUTLINE) / 2,
    },
  };
}

function distPointSeg(point, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = point.x - a.x;
  const apy = point.y - a.y;
  const ab2 = abx * abx + aby * aby;
  const t = ab2 === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
  return Math.hypot(point.x - (a.x + abx * t), point.y - (a.y + aby * t));
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function segmentsIntersect(a1, a2, b1, b2) {
  const d1x = a2.x - a1.x;
  const d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x;
  const d2y = b2.y - b1.y;
  const den = cross(d1x, d1y, d2x, d2y);
  if (Math.abs(den) < 1e-9) return false;
  const dx = b1.x - a1.x;
  const dy = b1.y - a1.y;
  const t = cross(dx, dy, d2x, d2y) / den;
  const u = cross(dx, dy, d1x, d1y) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function polygonsIntersectSAT(pa, pb) {
  const rings = [pa, pb];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 1) {
      const j = (i + 1) % ring.length;
      const nx = ring[j].y - ring[i].y;
      const ny = ring[i].x - ring[j].x;
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const point of pa) {
        const proj = point.x * nx + point.y * ny;
        minA = Math.min(minA, proj);
        maxA = Math.max(maxA, proj);
      }
      for (const point of pb) {
        const proj = point.x * nx + point.y * ny;
        minB = Math.min(minB, proj);
        maxB = Math.max(maxB, proj);
      }
      if (maxA < minB || maxB < minA) return false;
    }
  }
  return true;
}

function minDistPolygons(pa, pb) {
  if (polygonsIntersectSAT(pa, pb)) return 0;
  let min = Infinity;
  for (const point of pa) {
    for (let i = 0; i < pb.length; i += 1) {
      min = Math.min(min, distPointSeg(point, pb[i], pb[(i + 1) % pb.length]));
    }
  }
  for (const point of pb) {
    for (let i = 0; i < pa.length; i += 1) {
      min = Math.min(min, distPointSeg(point, pa[i], pa[(i + 1) % pa.length]));
    }
  }
  return min;
}

function pointInConvexPolygon(point, poly) {
  let sign = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const value = cross(b.x - a.x, b.y - a.y, point.x - a.x, point.y - a.y);
    if (Math.abs(value) < 1e-9) continue;
    const next = value > 0 ? 1 : -1;
    if (!sign) sign = next;
    else if (sign !== next) return false;
  }
  return true;
}

function minDistPolygonSegment(poly, a, b) {
  if (pointInConvexPolygon(a, poly) || pointInConvexPolygon(b, poly)) return 0;
  for (let i = 0; i < poly.length; i += 1) {
    if (segmentsIntersect(a, b, poly[i], poly[(i + 1) % poly.length])) return 0;
  }
  let min = Infinity;
  for (const point of poly) min = Math.min(min, distPointSeg(point, a, b));
  for (let i = 0; i < poly.length; i += 1) {
    const start = poly[i];
    const end = poly[(i + 1) % poly.length];
    min = Math.min(min, distPointSeg(a, start, end), distPointSeg(b, start, end));
  }
  return min;
}

function headAabb(head, pad) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of head) {
    minX = Math.min(minX, point.x - pad);
    maxX = Math.max(maxX, point.x + pad);
    minY = Math.min(minY, point.y - pad);
    maxY = Math.max(maxY, point.y + pad);
  }
  return { minX, maxX, minY, maxY };
}

function aabbsOverlap(a, b, gap = 0) {
  return !(
    a.maxX + gap < b.minX
    || b.maxX + gap < a.minX
    || a.maxY + gap < b.minY
    || b.maxY + gap < a.minY
  );
}

export function swellArrowCollision(primary, secondary, {
  outlineGap = SWELL_OUTLINE_GAP,
  minHeadCenter = 0,
} = {}) {
  const headStroke = SWELL_HEAD_STROKE / 2;
  const headHeadThreshold = headStroke + headStroke + outlineGap;
  const headHeadDist = minDistPolygons(primary.head, secondary.head);
  const headHead = headHeadDist < headHeadThreshold;
  const headShaftDist = minDistPolygonSegment(primary.head, secondary.shaft.a, secondary.shaft.b);
  const headShaft = headShaftDist < secondary.shaft.radius + headStroke + outlineGap;
  const shaftHeadDist = minDistPolygonSegment(secondary.head, primary.shaft.a, primary.shaft.b);
  const shaftHead = shaftHeadDist < primary.shaft.radius + headStroke + outlineGap;
  const headCenterDist = Math.hypot(
    primary.headCenter.x - secondary.headCenter.x,
    primary.headCenter.y - secondary.headCenter.y,
  );
  const bboxA = headAabb(primary.head, headStroke);
  const bboxB = headAabb(secondary.head, headStroke);
  const headBBox = aabbsOverlap(bboxA, bboxB, outlineGap);
  const collide = headHead || headShaft || shaftHead || headBBox || headCenterDist < minHeadCenter;
  return {
    collide,
    headHead,
    headShaft,
    shaftHead,
    headBBox,
    headHeadDist,
    headShaftDist,
    shaftHeadDist,
    headCenterDist,
    bboxA,
    bboxB,
  };
}

function applyPairOffsets(primarySpec, secondarySpec, perp, bisector, perpSign, bisSign, bisU) {
  const primary = {
    ...primarySpec,
    offsetPx: perpSign * perp,
    worldX: bisSign * bisector * bisU.x,
    worldY: bisSign * bisector * bisU.y,
  };
  const secondary = {
    ...secondarySpec,
    offsetPx: -perpSign * perp,
    worldX: -bisSign * bisector * bisU.x,
    worldY: -bisSign * bisector * bisU.y,
  };
  return { primary, secondary };
}

/**
 * Equal-and-opposite perpendicular offsets (local +Y / -Y), then a shared
 * travel-bisector shift if a fat head still clips the other shaft.
 * Does not rotate or shrink heads.
 */
export function separateSwellArrowPair(primarySpec, secondarySpec, opts = {}) {
  const scale = Number.isFinite(Number(opts.scale)) ? Number(opts.scale) : 1;
  const minHeadCenter = (opts.minHeadCenterGap ?? SWELL_MIN_HEAD_CENTER_GAP) * scale;
  const outlineGap = (opts.outlineGap ?? SWELL_OUTLINE_GAP) * scale;
  const maxPerp = (opts.maxPerp ?? SWELL_MAX_PERP_OFFSET) * scale;
  const maxBisector = (opts.maxBisector ?? SWELL_MAX_BISECTOR_OFFSET) * scale;
  const spotA = primarySpec.spot || (primarySpec.spotSlug ? { slug: primarySpec.spotSlug } : null);
  const spotB = secondarySpec.spot || (secondarySpec.spotSlug ? { slug: secondarySpec.spotSlug } : spotA);
  const travelA = spotA
    ? swellTravelBearingForSpot(primarySpec.sourceBearing, spotA)
    : swellSourceBearingToTravelBearing(primarySpec.sourceBearing);
  const travelB = spotB
    ? swellTravelBearingForSpot(secondarySpec.sourceBearing, spotB)
    : swellSourceBearingToTravelBearing(secondarySpec.sourceBearing);
  const bisU = unitBisector(travelA, travelB);
  const collisionOpts = { outlineGap, minHeadCenter };

  const score = (perp, bisector, perpSign, bisSign) => {
    const placed = applyPairOffsets(
      primarySpec,
      secondarySpec,
      perp,
      bisector,
      perpSign,
      bisSign,
      bisU,
    );
    const geoA = swellArrowWorldGeometry(placed.primary);
    const geoB = swellArrowWorldGeometry(placed.secondary);
    const hit = swellArrowCollision(geoA, geoB, collisionOpts);
    return { ...placed, geoA, geoB, hit, perp, bisector, perpSign, bisSign };
  };

  let best = null;
  const consider = (candidate) => {
    if (candidate.hit.collide) return;
    const cost = candidate.perp + candidate.bisector;
    if (
      !best
      || cost < best.perp + best.bisector
      || (cost === best.perp + best.bisector && candidate.bisector < best.bisector)
    ) {
      best = candidate;
    }
  };

  for (const perpSign of [1, -1]) {
    for (const bisSign of [1, -1]) {
      let resolved = false;
      for (let perp = 0; perp <= maxPerp + 1e-6; perp += 1) {
        const onlyPerp = score(perp, 0, perpSign, bisSign);
        if (!onlyPerp.hit.collide) {
          consider(onlyPerp);
          resolved = true;
          break;
        }
      }
      if (resolved) continue;
      for (let bisector = 1; bisector <= maxBisector + 1e-6; bisector += 1) {
        let found = false;
        for (let perp = 0; perp <= maxPerp + 1e-6; perp += 1) {
          const candidate = score(perp, bisector, perpSign, bisSign);
          if (!candidate.hit.collide) {
            consider(candidate);
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }
  }

  if (!best) {
    best = score(maxPerp, maxBisector, 1, 1);
  }

  return {
    primaryOffsetPx: best.primary.offsetPx,
    secondaryOffsetPx: best.secondary.offsetPx,
    primaryWorldX: best.primary.worldX,
    primaryWorldY: best.primary.worldY,
    secondaryWorldX: best.secondary.worldX,
    secondaryWorldY: best.secondary.worldY,
    perpPx: best.perp,
    bisectorPx: best.bisector,
    perpSign: best.perpSign,
    bisSign: best.bisSign,
    headCenterDist: best.hit.headCenterDist,
    collision: best.hit,
    usedHeadVsShaft: true,
    scale,
    minHeadCenter,
    outlineGap,
  };
}
