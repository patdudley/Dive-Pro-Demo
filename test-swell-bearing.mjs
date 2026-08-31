import {
  swellSourceBearingToTravelBearing,
  swellTravelBearingWestOfNorth,
  swellTravelBearingForSpot,
  swellTravelBearingToArrowRotateDeg,
  swellTravelUnitCanvas,
  swellDrawnHeadBearingFromTip,
  isTravelWestOfNorth,
  isForbiddenWestCoastShaft,
  defaultSwellArrowSpec,
  swellArrowWorldGeometry,
  swellArrowCollision,
  separateSwellArrowPair,
  SWELL_MIN_HEAD_CENTER_GAP,
  SWELL_OUTLINE_GAP,
  SWELL_NNW_FALLBACK_DEG,
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

function assertNear(got, expected, message, tol = 0.51) {
  const delta = Math.abs(((Number(got) - Number(expected) + 540) % 360) - 180);
  assert(delta <= tol, message);
}

function canvasTipHeading(travel) {
  const { x: ux, y: uy } = swellTravelUnitCanvas(travel);
  return ((Math.atan2(ux, -uy) * 180) / Math.PI + 360) % 360;
}

const scripps = { slug: "la-jolla" };
assert(swellTravelBearingWestOfNorth(202) === 338, `202° → ${swellTravelBearingWestOfNorth(202)}, expected 338`);
assert(swellTravelBearingWestOfNorth(170) === 350, `170° → ${swellTravelBearingWestOfNorth(170)}, expected 350`);
assert(swellTravelBearingWestOfNorth(180) === 350, `180° S → ${swellTravelBearingWestOfNorth(180)}, expected 350 (not 0 N, not 180 S)`);
assert(swellTravelBearingWestOfNorth(270) === 350, `270° W → ${swellTravelBearingWestOfNorth(270)}, expected 350 (not 90 E)`);
assert(swellTravelBearingWestOfNorth(193) === 347, `193° SSW → ${swellTravelBearingWestOfNorth(193)}, expected 347 NNW (not 13 NNE)`);
assert(swellTravelBearingWestOfNorth(278) === 350, `278° W → ${swellTravelBearingWestOfNorth(278)}, expected 350 NNW (not 278 west offshore, not 90 E)`);
assert(swellTravelBearingForSpot(202, scripps) === 338, "La Jolla 202 uses west-of-north");
assert(swellTravelBearingForSpot(170, scripps) === 350, "La Jolla 170 stays 350");
assert(swellTravelBearingForSpot(180, scripps) === 350, "La Jolla south swell draws 350, not south");
assert(swellTravelBearingForSpot(193, scripps) === 347, "La Jolla 193 draws 347, not 13");
assert(swellTravelBearingForSpot(278, scripps) === 350, "La Jolla 278 draws 350, not west offshore");
assert(swellTravelBearingForSpot(270, { slug: "monterey" }) === 350, "Monterey W swell is not due east");
assert(swellTravelBearingForSpot(270, { slug: "catalina-wrigley" }) === 350, "Catalina W swell is not due east");
assert(isTravelWestOfNorth(338), "338 is west of north");
assert(isTravelWestOfNorth(347), "347 NNW is west of north");
assert(isTravelWestOfNorth(350), "350 is west of north");
assert(!isTravelWestOfNorth(0), "exact N is not preferred west-of-north");
assert(!isTravelWestOfNorth(13), "13 NNE is east of north");
assert(!isTravelWestOfNorth(22), "22 NNE is east of north");
assert(!isTravelWestOfNorth(90), "90 E is east of north");
assert(!isTravelWestOfNorth(180), "180 S is forbidden");
assert(!isTravelWestOfNorth(170), "170 S is a forbidden shaft heading");
assert(!isTravelWestOfNorth(278), "278 W is west-offshore, not NW–NNW");
assert(isForbiddenWestCoastShaft(13), "13 NNE is a forbidden shaft");
assert(isForbiddenWestCoastShaft(90), "90 E is a forbidden shaft");
assert(isForbiddenWestCoastShaft(180), "180 S is a forbidden shaft");
assert(isForbiddenWestCoastShaft(170), "170 S is a forbidden shaft");
assert(isForbiddenWestCoastShaft(278), "278 W offshore is a forbidden shaft");
assert(SWELL_NNW_FALLBACK_DEG === 350, "NNW fallback is 350");

const geo202 = swellArrowWorldGeometry({
  ...defaultSwellArrowSpec("primary"),
  sourceBearing: 202,
  spot: scripps,
});
assert(geo202.sourceBearing === 202, `202° label flipped to ${geo202.sourceBearing}`);
assert(geo202.travelBearing === 338, `202° drawn travel ${geo202.travelBearing}, expected 338`);

const geo170 = swellArrowWorldGeometry({
  ...defaultSwellArrowSpec("secondary"),
  sourceBearing: 170,
  spot: scripps,
});
assert(geo170.sourceBearing === 170, `170° label flipped to ${geo170.sourceBearing}`);
assert(geo170.travelBearing === 350, `170° drawn travel ${geo170.travelBearing}, expected 350`);

const geoW = swellArrowWorldGeometry({
  ...defaultSwellArrowSpec("primary"),
  sourceBearing: 270,
  spot: scripps,
});
assert(geoW.sourceBearing === 270, `W swell label flipped to ${geoW.sourceBearing}`);
assert(geoW.travelBearing === 350, `W swell drew ${geoW.travelBearing}, must not be 90 E`);
assert(isTravelWestOfNorth(geoW.travelBearing), "W swell head must sit west of north");

const southGeo = swellArrowWorldGeometry({
  ...defaultSwellArrowSpec("secondary"),
  sourceBearing: 180,
  spot: scripps,
});
assert(southGeo.sourceBearing === 180, `180° label flipped to ${southGeo.sourceBearing}`);
assert(southGeo.travelBearing === 350, `180° S drew ${southGeo.travelBearing}, expected 350 NNW`);

const geo193 = swellArrowWorldGeometry({
  ...defaultSwellArrowSpec("primary"),
  sourceBearing: 193,
  spot: scripps,
});
assert(geo193.sourceBearing === 193, `193° label flipped to ${geo193.sourceBearing}`);
assert(geo193.travelBearing === 347, `193° drawn travel ${geo193.travelBearing}, expected 347`);
assertNear(
  swellDrawnHeadBearingFromTip(geo193.tip),
  347,
  `193° HTML rose head ${swellDrawnHeadBearingFromTip(geo193.tip)}, expected 347 NNW not 13 NNE`,
);

const geo278 = swellArrowWorldGeometry({
  ...defaultSwellArrowSpec("secondary"),
  sourceBearing: 278,
  spot: scripps,
});
assert(geo278.sourceBearing === 278, `278° label flipped to ${geo278.sourceBearing}`);
assert(geo278.travelBearing === 350, `278° drawn travel ${geo278.travelBearing}, expected 350`);
assertNear(
  swellDrawnHeadBearingFromTip(geo278.tip),
  350,
  `278° HTML rose head ${swellDrawnHeadBearingFromTip(geo278.tip)}, expected 350 NNW not 278 W`,
);

assertNear(canvasTipHeading(347), 347, `canvas tip for 347 aimed at ${canvasTipHeading(347)}`);
assertNear(canvasTipHeading(350), 350, `canvas tip for 350 aimed at ${canvasTipHeading(350)}`);
assertNear(canvasTipHeading(swellTravelBearingWestOfNorth(193)), 347, "canvas 193 head is 347, not 13");
assertNear(canvasTipHeading(swellTravelBearingWestOfNorth(278)), 350, "canvas 278 head is 350, not 278");

for (const heading of [
  geo202.travelBearing,
  geo170.travelBearing,
  geoW.travelBearing,
  southGeo.travelBearing,
  geo193.travelBearing,
  geo278.travelBearing,
]) {
  assert(!isForbiddenWestCoastShaft(heading), `forbidden shaft heading ${heading}`);
  assert(isTravelWestOfNorth(heading), `shaft ${heading} is not NW–NNW`);
}

const anacapaEast = swellTravelBearingForSpot(270, { slug: "anacapa-ocean" });
assert(anacapaEast !== 90 && anacapaEast !== 45, "Anacapa must not draw east into the Channel");
assert(anacapaEast > 270 && anacapaEast <= 360, `Anacapa east-origin drew ${anacapaEast}`);

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

function separatedClamped(primaryFrom, secondaryFrom) {
  const primary = { ...defaultSwellArrowSpec("primary"), sourceBearing: primaryFrom, spot: scripps };
  const secondary = { ...defaultSwellArrowSpec("secondary"), sourceBearing: secondaryFrom, spot: scripps };
  const sep = separateSwellArrowPair(primary, secondary);
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
    outlineGap: sep.outlineGap,
    minHeadCenter: sep.minHeadCenter,
  });
  return { primary, secondary, sep, geoA, geoB, hit };
}

const monday = separatedClamped(193, 278);
assert(monday.geoA.sourceBearing === 193, `Monday primary label ${monday.geoA.sourceBearing}`);
assert(monday.geoB.sourceBearing === 278, `Monday secondary label ${monday.geoB.sourceBearing}`);
assert(monday.geoA.travelBearing === 347, `Monday primary shaft ${monday.geoA.travelBearing}, expected 347`);
assert(monday.geoB.travelBearing === 350, `Monday secondary shaft ${monday.geoB.travelBearing}, expected 350`);
assert(!monday.hit.collide, `Monday 193/278 still collides ${JSON.stringify(monday.hit)}`);
const mondayTipA = swellDrawnHeadBearingFromTip(monday.geoA.tip);
const mondayTipB = swellDrawnHeadBearingFromTip(monday.geoB.tip);
assert(isTravelWestOfNorth(mondayTipA), `Monday primary tip ${mondayTipA.toFixed(1)} is not west of N`);
assert(isTravelWestOfNorth(mondayTipB), `Monday secondary tip ${mondayTipB.toFixed(1)} is not west of N`);
assert(!isForbiddenWestCoastShaft(mondayTipA), `Monday primary tip ${mondayTipA.toFixed(1)} forbidden`);
assert(!isForbiddenWestCoastShaft(mondayTipB), `Monday secondary tip ${mondayTipB.toFixed(1)} forbidden`);
assert(mondayTipA >= 315 && mondayTipA <= 355, `Monday cyan tip ${mondayTipA.toFixed(1)} too close to N or east`);
assert(mondayTipB >= 315 && mondayTipB <= 355, `Monday magenta tip ${mondayTipB.toFixed(1)} not in NW–NNW`);

const overnight = separatedClamped(202, 170);
assert(overnight.geoA.travelBearing === 338, `overnight 202 shaft ${overnight.geoA.travelBearing}`);
assert(overnight.geoB.travelBearing === 350, `overnight 170 shaft ${overnight.geoB.travelBearing}`);
assert(isTravelWestOfNorth(swellDrawnHeadBearingFromTip(overnight.geoA.tip)), "overnight 202 tip east of N");
assert(isTravelWestOfNorth(swellDrawnHeadBearingFromTip(overnight.geoB.tip)), "overnight 170 tip east of N");

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
console.log(`ok ${travelCases.length} travel + west-of-north 193/278/202/170 + ${rotateCases.length} rotate + separation`);
