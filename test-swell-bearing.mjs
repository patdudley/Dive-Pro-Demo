import {
  swellSourceBearingToTravelBearing,
  swellSourceBearingTowardLand,
  swellTravelBearingToArrowRotateDeg,
  defaultSwellArrowSpec,
  swellArrowWorldGeometry,
  swellArrowCollision,
  separateSwellArrowPair,
  SWELL_MIN_HEAD_CENTER_GAP,
  SWELL_OUTLINE_GAP,
} from "./swell-bearing.js";

const travelCases = [
  [0, 180],
  [90, 270],
  [170, 350],
  [180, 0],
  [203, 23],
  [270, 90],
  [359, 179],
];

let failed = 0;
function assert(cond, message) {
  if (!cond) {
    console.error(message);
    failed += 1;
  }
}

for (const [source, expected] of travelCases) {
  const got = swellSourceBearingToTravelBearing(source);
  assert(got === expected, `travel ${source} → ${got}, expected ${expected}`);
}

const landwardCases = [
  // La Jolla / Monterey / Catalina: land is east.
  [203, 90, 203],
  [170, 90, 350],
  [90, 90, 270],
  [270, 90, 270],
  // Anacapa card: land is northeast.
  [225, 45, 225],
  [45, 45, 225],
];
for (const [source, land, expected] of landwardCases) {
  const got = swellSourceBearingTowardLand(source, land);
  assert(got === expected, `landward source ${source} toward ${land} → ${got}, expected ${expected}`);
  const travel = swellSourceBearingToTravelBearing(got);
  const distance = Math.abs(((travel - land + 540) % 360) - 180);
  assert(distance <= 90, `landward travel ${travel} is ${distance}° from land bearing ${land}`);
}

// East-pointing shaft: travel north (0) must rotate to CSS 270° (up).
const rotateCases = [
  [0, 270],
  [23, 293],
  [90, 0],
  [180, 90],
  [350, 260],
];
for (const [travel, expected] of rotateCases) {
  const got = swellTravelBearingToArrowRotateDeg(travel);
  assert(got === expected, `rotate ${travel} → ${got}, expected ${expected}`);
}

function pairSpecs(primaryFrom, secondaryFrom) {
  return {
    primary: { ...defaultSwellArrowSpec("primary"), sourceBearing: primaryFrom },
    secondary: { ...defaultSwellArrowSpec("secondary"), sourceBearing: secondaryFrom },
  };
}

function separatedCollision(primaryFrom, secondaryFrom, scale = 1) {
  const { primary, secondary } = pairSpecs(primaryFrom, secondaryFrom);
  const sep = separateSwellArrowPair(primary, secondary, { scale });
  const geoA = swellArrowWorldGeometry({
    ...primary,
    offsetPx: sep.primaryOffsetPx,
    worldX: sep.primaryWorldX,
    worldY: sep.primaryWorldY,
  });
  const geoB = swellArrowWorldGeometry({
    ...secondary,
    offsetPx: sep.secondaryOffsetPx,
    worldX: sep.secondaryWorldX,
    worldY: sep.secondaryWorldY,
  });
  const hit = swellArrowCollision(geoA, geoB, {
    outlineGap: SWELL_OUTLINE_GAP * scale,
    minHeadCenter: SWELL_MIN_HEAD_CENTER_GAP * scale,
  });
  return { primary, secondary, sep, geoA, geoB, hit };
}

const unoffsetLajollaLive = pairSpecs(200, 250);
const liveBefore = swellArrowCollision(
  swellArrowWorldGeometry(unoffsetLajollaLive.primary),
  swellArrowWorldGeometry(unoffsetLajollaLive.secondary),
  { outlineGap: SWELL_OUTLINE_GAP, minHeadCenter: 0 },
);
assert(
  liveBefore.headHead || liveBefore.headShaft || liveBefore.shaftHead,
  "expected unoffset SSW/WSW heads or head-vs-shaft to collide",
);

const cases = [
  ["La Jolla live-like SSW/WSW", 200, 250],
  ["La Jolla JSON S/W", 182, 279],
  ["screenshot-like 202/247", 202, 247],
  ["close stacked 180/190", 180, 190],
  ["near-parallel 175/188", 175, 188],
];

for (const [label, primaryFrom, secondaryFrom] of cases) {
  const { sep, geoA, geoB, hit, primary, secondary } = separatedCollision(primaryFrom, secondaryFrom);
  assert(!hit.collide, `${label}: still collides after separation ${JSON.stringify(hit)}`);
  assert(!hit.headHead, `${label}: head vs head still intersects`);
  assert(!hit.headShaft, `${label}: primary head vs secondary shaft still intersects`);
  assert(!hit.shaftHead, `${label}: secondary head vs primary shaft still intersects`);
  assert(!hit.headBBox, `${label}: head bounding boxes still overlap`);
  assert(
    hit.headCenterDist + 1e-6 >= SWELL_MIN_HEAD_CENTER_GAP,
    `${label}: head-center ${hit.headCenterDist.toFixed(2)} < ${SWELL_MIN_HEAD_CENTER_GAP}`,
  );
  assert(
    Math.abs(sep.primaryOffsetPx + sep.secondaryOffsetPx) < 1e-6,
    `${label}: perp offsets are not equal and opposite (${sep.primaryOffsetPx}, ${sep.secondaryOffsetPx})`,
  );
  assert(
    geoA.travelBearing === swellSourceBearingToTravelBearing(primary.sourceBearing),
    `${label}: primary travel bearing changed`,
  );
  assert(
    geoB.travelBearing === swellSourceBearingToTravelBearing(secondary.sourceBearing),
    `${label}: secondary travel bearing changed`,
  );
  assert(geoA.headSize === 20 && geoB.headSize === 17, `${label}: head sizes changed`);
  assert(sep.usedHeadVsShaft === true, `${label}: head-vs-shaft test not recorded`);
}

const mobile = separatedCollision(200, 250, 1);
assert(!mobile.hit.collide, "mobile SSW/WSW still collides");
assert(mobile.sep.minHeadCenter === SWELL_MIN_HEAD_CENTER_GAP, "app keeps the desktop SVG gap at every size");

const single = swellArrowWorldGeometry({
  ...defaultSwellArrowSpec("primary"),
  sourceBearing: 182,
});
assert(single.travelBearing === 2, `single S travel ${single.travelBearing}`);
assert(single.rotateDeg === 272, `single S rotate ${single.rotateDeg}`);

if (failed) {
  console.error(`FAIL ${failed} assertion(s)`);
  process.exit(1);
}
console.log(`ok ${travelCases.length} travel + ${landwardCases.length} landward + ${rotateCases.length} rotate + separation`);
