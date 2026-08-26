# Reference drone component sources

Access date for every source: **2026-08-26**.

The reference assembly is a recognizable 5-inch quadrotor built from exact,
named products. It contains no downloaded manufacturer or third-party CAD.
Every display and collision shape is `modeled-from-specification` using the
bounded box, cylinder, transform, named-interface, union, and subtraction
operations supported by the repository. All catalog values and assembly
placements are metres and kilograms; `drone-workspace.ts` converts them to the
viewer's established millimetre boundary.

## Source and redistribution record

| Catalog record | Exact identity | Published mechanical facts used | Mass used | Dimensional uncertainty | Source and redistribution status |
| --- | --- | --- | --- | --- | --- |
| `motor-2207` | Hobbywing XRotor-2207.5SL-1780KV | Motor Ø28 × H19.9 mm; stator Ø22.5 × 7.6 mm; shaft Ø5 mm + M5 and 12 mm long; 4×M3 on Ø16 mm; 20AWG, 150 mm leads | 38 g including wire | No tolerance is published. Bell, base, and transition contours are illustrative but bounded by the published envelope. The four nominal M3 interfaces are placed on the published pitch circle. | [Manufacturer specification PDF](https://www.hobbywing.com/en/uploads/file/20251117/feb50ba5342e53ce2431c20799f047d8.pdf) and [manufacturer product page](https://www.hobbywing.com/en/products/xrotor-22075). Hobbywing offers CAD behind its own download disclaimer, but no explicit redistribution grant was identified. No Hobbywing CAD or images are included; only attributed specification facts are modeled. |
| `fc-esc-stack-30x30` | SpeedyBee F405 V4 + BLS 55A Stack, SKU SB-F4V4-55-STACK | FC 41.6 × 39.4 × 7.8 mm, 30.5 × 30.5 mm mounting with Ø4 mm holes; ESC 45.6 × 44 × 8 mm with the same mounting pattern | FC 10.5 g + ESC 23.5 g = 34 g | Board dimensions are published without tolerances. Installed spacing is not specified; the display uses a 4 mm clear board gap with ±2 mm assembly uncertainty. The protected envelope adds 3 mm clearance per side. | [Manufacturer product/specification page](https://www.speedybee.com/speedybee-f405-v4-bls-55a-30x30-fc-esc-stack/). The page marks this SKU discontinued, but its mechanical record remains exact. No explicit CAD redistribution grant was identified and no SpeedyBee asset is included. |
| `battery-6s-1550` | Tattu R-Line Version 5.0, TA-RL5-150C-1550-6S1P | 78 × 37 × 52 mm; XT60; 45 mm, 12AWG discharge leads | 254 g | Manufacturer tolerances are length ±5 mm, width ±2 mm, height ±2 mm, and mass ±20 g. The protected envelope adds 3 mm per side and does not claim the flexible lead shape. | [Manufacturer product/specification page](https://www.genstattu.com/tattu-r-line-version-5-0-1550mah-6s-150c-22-2v-lipo-battery-pack-with-xt60-plug/). No explicit CAD redistribution grant was identified and no Tattu asset is included. |
| `fastener-m3x8` | Accu SSCF-M3-8-12.9-Z | M3 × 8 mm full thread; Ø5.68 mm head; 3 mm head height; 2.5 mm socket; 1.3 mm drive depth; 0.5 mm pitch; DIN 912 | 0.80 g, derived from published 80 g per 100 units | Published head tolerances are +0/−0.36 mm diameter and +0/−0.14 mm height. Threads use their nominal cylindrical collision envelope and the square recess is an intentionally bounded display approximation of the hex socket. | [Supplier product specification](https://www.accu.co.uk/metric-cap-head-screws/386767-SSCF-M3-8-12-9-Z). The page does not provide an available CAD download or an explicit redistribution grant. No Accu CAD or imagery is included. |
| `propeller-5x4.3x3` | HQProp HQ5X4.3X3V2S-PC | 5-inch diameter, 4.3-inch pitch, 3 blades, Ø12.8 × 6.5 mm hub, Ø5 mm shaft | 3.8 g | No product tolerances or blade airfoil coordinates are published. The visible blade planform is illustrative. Collision uses the full swept disc; the protected disc radius is 66 mm, adding 2.5 mm radial clearance to the exact 63.5 mm nominal radius. | [Manufacturer product/specification page](https://www.hqprop.com/hq-freestyle-prop-5x43x3v2s-2cw2ccw-poly-carbonate-p0233.html). The page is copyright HQProp and gives no explicit CAD redistribution grant. No HQProp CAD or imagery is included. |
| `motor-wiring-corridor` | Reference 3×20AWG motor-lead routing corridor rev 1 | Two orthogonal 184 × 6 × 6 mm protected routes connect the motor and central-stack regions; motor source specifies three 20AWG, 150 mm leads | 0 kg with accounting role `none`; this derived clearance constraint is not a physical BOM component | The 6 mm corridor section and assembly route are conservative design assumptions, not manufacturer dimensions. No independent harness mass is claimed. | Derived-constraint inputs are the [Hobbywing motor lead specification](https://www.hobbywing.com/en/uploads/file/20251117/feb50ba5342e53ce2431c20799f047d8.pdf) and [SpeedyBee stack connection specification](https://www.speedybee.com/speedybee-f405-v4-bls-55a-30x30-fc-esc-stack/). No external asset is included. |
| `body-interface` | Sunderlabs FRAME-INTERFACE-01 | 28 × 38 × 6 mm plate, two M3 interfaces at 24 mm spacing, and one 14 × 12 × 12 mm cable keep-out | 18 g | The local reference drawing is exact for this foundation fixture and is not presented as a production frame specification. | Local engineering drawing `sunderlabs:foundation-interface:rev-1`; specification facts only. |

## Geometry and optimization boundary

- Every assembly `instance.position` is the world location of the component's
  declared local anchor. Motors use the mount plane at local z=0, screws use the
  under-head bearing plane, and propellers use the hub mid-plane. Motor graph,
  display pieces, collisions, mount interfaces, and screw placements use this
  same convention.
- The motor graph explicitly includes the outer bell, stator/body, shaft, base,
  named motor-mount interface, four pitch-circle holes, unions, and
  subtractions. The viewer uses the same catalog dimensions to render four
  multi-piece motors; it does not maintain a second product fixture.
- The avionics view is two separate detailed boards at the published FC and ESC
  sizes. Their centers are shifted by the exact 0.1 mm needed to place the
  combined 19.8 mm stack bounds symmetrically around the same anchor used by
  collision and envelope geometry. Their four Ø4 mm mounting interfaces are
  preserved on the published 30.5 mm square pattern.
- Sixteen M3×8 motor screws are physical fixed-component instances. Their
  under-head anchors sit on the underside of each 6 mm generated plate, their
  8 mm shanks pass through the plate, and the recessed drive opens through the
  exposed head face. Compiled and viewer geometry read the same graph.
- Battery, motor, avionics, and fastener collision records are immutable
  component geometry. Their keep-outs are obstacles to generated frame
  material.
- Each propeller is a visible three-blade component alongside a distinct filled
  66 mm radius × 8.5 mm protected swept volume. The exact component revision
  supplies the `protected` role to every assembly instance; neither blades nor
  rotor envelopes are optimized frame structure.
- Wiring corridors are visibly rendered as translucent constraint boxes. They
  are protected geometry and are never counted or rendered as generated
  structure; their zero mass and `none` accounting role reflect that the
  corridor is a derived clearance constraint rather than a physical BOM item.

## Known limits

This catalog is suitable for the reference visualization, collision planning,
interface preservation, and mass accounting. It is not manufacturer CAD and
does not establish aerodynamic, thermal, vibration, fatigue, or certified
clearance fidelity. The stack gap and wiring route must be measured from the
actual build before manufacturing.
