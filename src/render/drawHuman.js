export function drawHuman(r, spec, pose) {
  const {
    x, y,
    facing = 0,
    walkPhase = 0,
    suit = null,
    alive = true,
  } = pose;

  const scale = (spec.height || 1.75) / 1.75;
  const buildMul = spec.build === 'slim' ? 0.92 : spec.build === 'heavy' ? 1.14 : 1.0;
  const s = scale * buildMul;

  const torsoRx = 0.28 * s;
  const torsoRy = 0.22 * s;
  const headR = 0.13 * scale;
  const armR = 0.08 * s;
  const shoeR = 0.055 * s;

  const c = Math.cos(facing);
  const sn = Math.sin(facing);
  const rot = (lx, ly) => ({ x: x + lx * c - ly * sn, y: y + lx * sn + ly * c });

  // shadow
  r.drawEllipse(x, y + 0.05, torsoRx * 1.1, torsoRy * 0.9, facing, { fill: 'rgba(0,0,0,0.4)' });

  // shoes behind torso with walking sway
  const swing = Math.sin(walkPhase) * 0.055;
  const pL = rot(-0.03, -0.10 + swing);
  const pR = rot(-0.03,  0.10 - swing);
  r.drawCircle(pL.x, pL.y, shoeR, { fill: '#141414' });
  r.drawCircle(pR.x, pR.y, shoeR, { fill: '#141414' });

  // torso (outfit color)
  r.drawEllipse(x, y, torsoRx, torsoRy, facing, { fill: spec.outfit.top });

  if (spec.outfit.pattern === 'stripe') {
    const a = rot(-torsoRx * 0.65, 0);
    const b = rot( torsoRx * 0.65, 0);
    r.drawLine(a.x, a.y, b.x, b.y, { stroke: spec.outfit.accent, lineWidth: 0.025 });
  } else if (spec.outfit.pattern === 'logo') {
    const l = rot(torsoRx * 0.28, 0);
    r.drawCircle(l.x, l.y, 0.04, { fill: spec.outfit.accent });
  }

  // arms on torso sides, swinging
  const armSwing = Math.sin(walkPhase) * 0.05;
  const aL = rot(armSwing * 0.5, -torsoRx * 0.95 - armR * 0.4);
  const aR = rot(-armSwing * 0.5,  torsoRx * 0.95 + armR * 0.4);
  r.drawCircle(aL.x, aL.y, armR, { fill: spec.outfit.top });
  r.drawCircle(aR.x, aR.y, armR, { fill: spec.outfit.top });

  // Gantz suit overlay (darker shell with red piping)
  if (suit) {
    r.drawEllipse(x, y, torsoRx * 1.03, torsoRy * 1.03, facing, { fill: 'rgba(8,8,14,0.9)' });
    const h0 = rot(-torsoRx * 0.7, 0);
    const h1 = rot( torsoRx * 0.7, 0);
    r.drawLine(h0.x, h0.y, h1.x, h1.y, { stroke: '#c8142b', lineWidth: 0.03 });
    const v0 = rot(0, -torsoRy * 0.65);
    const v1 = rot(0,  torsoRy * 0.65);
    r.drawLine(v0.x, v0.y, v1.x, v1.y, { stroke: '#c8142b', lineWidth: 0.02, alpha: 0.65 });
    r.drawCircle(aL.x, aL.y, armR, { fill: '#0a0a12' });
    r.drawCircle(aR.x, aR.y, armR, { fill: '#0a0a12' });
  }

  const hairStyle = spec.hair?.style || 'short';
  const hairColor = spec.hair?.color || '#1a1a1a';

  // hair trail behind head (long, ponytail)
  if (hairStyle === 'long') {
    const tip = rot(-headR * 2.4, 0);
    const bl = rot(-headR * 0.3, -headR * 0.65);
    const br = rot(-headR * 0.3,  headR * 0.65);
    r.drawPolygon([[bl.x, bl.y], [br.x, br.y], [tip.x, tip.y]], { fill: hairColor });
  } else if (hairStyle === 'ponytail') {
    const a = rot(-headR * 0.2, 0);
    const b = rot(-headR * 1.7, 0);
    r.drawLine(a.x, a.y, b.x, b.y, { stroke: hairColor, lineWidth: headR * 0.55 });
  }

  // scalp layer (hair or skin if bald)
  const hc = rot(0.02 * scale, 0);
  if (hairStyle === 'bald') {
    r.drawCircle(hc.x, hc.y, headR, { fill: spec.skin });
  } else {
    r.drawCircle(hc.x, hc.y, headR, { fill: hairColor });
    if (hairStyle === 'buzz') {
      r.drawCircle(hc.x, hc.y, headR * 0.96, { fill: spec.skin, alpha: 0.42 });
    } else if (hairStyle === 'messy') {
      const cps = [[-headR*0.5, headR*0.25], [headR*0.3, -headR*0.5], [-headR*0.2, -headR*0.55], [headR*0.45, headR*0.3]];
      for (const [lx, ly] of cps) {
        const cp = rot(lx, ly);
        r.drawCircle(cp.x, cp.y, 0.042 * scale, { fill: hairColor });
      }
    } else if (hairStyle === 'topknot') {
      const knot = rot(-headR * 0.1, 0);
      r.drawCircle(knot.x, knot.y, headR * 0.55, { fill: hairColor });
    }
    // face slice showing skin at front
    const face = rot(headR * 0.58, 0);
    r.drawEllipse(face.x, face.y, headR * 0.48, headR * 0.55, facing, { fill: spec.skin });
  }

  // brow / nose hint at front of head
  const nose = rot(headR * 0.72, 0);
  r.drawCircle(nose.x, nose.y, 0.018 * scale, { fill: 'rgba(0,0,0,0.75)' });

  if (!alive) {
    r.drawCircle(x, y, torsoRx * 1.35, { stroke: '#c8142b', lineWidth: 0.04, alpha: 0.55 });
    const dA = rot(torsoRx * 0.6, -torsoRx * 0.6);
    const dB = rot(-torsoRx * 0.6, torsoRx * 0.6);
    r.drawLine(dA.x, dA.y, dB.x, dB.y, { stroke: '#c8142b', lineWidth: 0.04 });
  }
}
