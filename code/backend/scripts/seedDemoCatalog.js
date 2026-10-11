// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: a demo catalogue (90 assets by default, up to 120) for exercising AI search at realistic size (SCRUM-243, OD-10)
// Human Contributions: asked for by Amber Rastella to test AI search with a larger catalogue; reviewer recorded on the PR
// Notes: Development data only; refuses to run with NODE_ENV=production.

/* eslint-disable no-console */

/**
 * `npm run seed:catalog [-- --count <n>] [-- --org <slug>] [-- --remove]`: adds a demo catalogue of
 * `n` assets (default 90, at most 120) to one organisation (default `org-b`, from `npm run seed`), or
 * removes it again.
 *
 * **Why 90 by default:** a full-looking catalogue for a demo that stays under the 100 candidates AI
 * search sends the model (AI_MAX_CANDIDATES), so every search considers every item and the AI search
 * page shows no catalog-size warning. **`--count 120`** goes past the limit on purpose, to exercise the
 * cut-off and that warning (OD-10, SCRUM-243). Assets are taken evenly across the 15 categories, the
 * first of each category before the second of any, so 90 is six per category and still includes every
 * dead end below.
 *
 * Either size also tests whether the model finds the right item among many: every description
 * says what the item is for, not only what it is, so "something to record an interview" has a fair
 * chance of reaching "Zoom H5 Recorder" through meaning rather than shared words.
 *
 * What it creates, per asset: one to three units, all AVAILABLE, except five assets whose every unit is
 * in MAINTENANCE. Those are dead ends with same-category substitutes in the catalogue, for the
 * similar-items section (SCRUM-151, SCRUM-184). MAINTENANCE rather than OUT because an OUT unit needs a
 * checkout request behind it, and this script creates none.
 *
 * Additive and repeatable: an asset whose name already exists in the organisation is skipped, so the
 * two items added by hand during testing (Dell Latitude 5440, Acer Chromebook 14) are left alone, and
 * running it twice adds nothing the second time. `--remove` deletes exactly the assets named below and
 * their units, nothing else. No audit events are written: this is fixture data, the same as
 * `npm run seed`.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { Asset } from '../src/models/Asset.js';
import { AssetUnit } from '../src/models/AssetUnit.js';
import { Organization } from '../src/models/Organization.js';
import * as assetRepo from '../src/repositories/asset.repository.js';
import * as unitRepo from '../src/repositories/assetUnit.repository.js';
import { UNIT_STATUS } from '../src/utils/constants.js';

dotenv.config({ path: ['.env', '../../.env'] });

/** Assets whose every unit is in maintenance: the dead ends similar items should rescue. */
const DEAD_ENDS = new Set([
  'Sony A7 IV',
  'Zoom H5 Recorder',
  'MacBook Pro 14 (M3)',
  'Meta Quest 3',
  'DJI Mini 4 Pro',
]);

/** 15 categories × 8 assets. [name, description] pairs, grouped by category. */
const CATALOG = {
  Camera: [
    ['Canon EOS R6', 'Full-frame mirrorless body for events, portraits and low-light photography'],
    [
      'Sony A7 IV',
      'Full-frame mirrorless with strong autofocus; shoots 4K video as well as stills',
    ],
    ['Nikon Z6 II', 'Full-frame mirrorless body, weather sealed, good for outdoor shoots'],
    ['Fujifilm X-T4', 'APS-C mirrorless with in-body stabilisation and film-style colour'],
    ['Canon EOS Rebel T7', 'Beginner DSLR kit for photography classes and first projects'],
    ['GoPro HERO12 Black', 'Rugged action camera for sports, field trips and wearable footage'],
    ['Insta360 X3', '360-degree camera for virtual tours and immersive video'],
    ['Panasonic Lumix GH6', 'Micro Four Thirds body aimed at video production and vlogging'],
  ],
  Lens: [
    ['Canon RF 24-105mm f/4', 'General-purpose zoom for Canon RF mirrorless bodies'],
    ['Sony FE 50mm f/1.8', 'Small prime for portraits and shallow depth of field on Sony bodies'],
    ['Sigma 18-35mm f/1.8 Art', 'Bright APS-C zoom popular for video interviews'],
    ['Rokinon 14mm f/2.8', 'Ultra-wide manual-focus lens for architecture and night skies'],
    ['Canon EF 70-200mm f/2.8', 'Telephoto zoom for sports, graduations and stage events'],
    ['Tamron 28-75mm f/2.8', 'Standard zoom for Sony E-mount, light enough for all-day events'],
    ['Nikon Z 85mm f/1.8', 'Portrait prime for Nikon Z bodies'],
    ['Sony FE 16-35mm f/4', 'Wide zoom for interiors, landscapes and group shots'],
  ],
  Audio: [
    ['Zoom H5 Recorder', 'Handheld 4-track field recorder for interviews, lectures and podcasts'],
    ['Zoom H1n Recorder', 'Pocket stereo recorder for voice notes and simple lecture capture'],
    ['Rode Wireless GO II', 'Two-person wireless clip-on microphone kit for interviews on camera'],
    ['Shure SM58 Microphone', 'Durable handheld vocal mic for live events and announcements'],
    ['Rode NT-USB Microphone', 'Plug-in USB desk mic for podcasts, voice-over and online meetings'],
    ['Sennheiser MKE 600 Shotgun Mic', 'Directional on-camera mic that rejects room noise'],
    ['Tascam DR-40X Recorder', 'Four-track recorder with XLR inputs for music and panel sessions'],
    [
      'Audio-Technica ATH-M50x Headphones',
      'Closed-back studio headphones for editing and monitoring',
    ],
  ],
  Video: [
    ['Sony FX3 Cinema Camera', 'Compact cinema camera for short films and high-end video projects'],
    ['Blackmagic Pocket 6K', 'Cinema camera that records RAW footage for colour grading'],
    ['Canon XA11 Camcorder', 'Professional camcorder for recording talks, sports and ceremonies'],
    ['Panasonic HC-V770 Camcorder', 'Easy point-and-shoot camcorder for class recordings'],
    ['DJI Ronin RS 3 Gimbal', 'Motorised stabiliser for smooth handheld camera movement'],
    ['Atomos Ninja V Monitor', 'External 5-inch monitor and recorder for camera rigs'],
    ['Elgato Cam Link 4K', 'Turns a camera into a webcam for streaming and video calls'],
    ['Blackmagic ATEM Mini Pro', 'Live switcher for streaming multi-camera events'],
  ],
  Lighting: [
    ['Aputure Amaran 200d', 'Daylight LED spotlight for interviews and small sets'],
    ['Godox SL60W LED', 'Budget continuous light for video and product shots'],
    ['Neewer 660 LED Panel', 'Dimmable bi-colour panel light, comes as a pair with stands'],
    ['Elgato Key Light', 'Desk-mounted soft light for streaming and video calls'],
    ['Lume Cube Panel Mini', 'Pocket LED light for phones and small cameras'],
    ['Godox AD200 Flash', 'Portable flash for on-location portraits'],
    ['Westcott 5-in-1 Reflector', 'Collapsible reflector and diffuser for natural-light shoots'],
    ['Neewer Ring Light 18in', 'Ring light for portraits, makeup tutorials and video calls'],
  ],
  Support: [
    ['Manfrotto 190X Tripod', 'Sturdy aluminium photo tripod with ball head'],
    ['Benro Video Tripod', 'Fluid-head tripod for smooth pans while filming'],
    ['Joby GorillaPod 5K', 'Flexible tripod that wraps around railings and branches'],
    ['Peak Design Travel Tripod', 'Compact carbon tripod for travel and field work'],
    ['Manfrotto Monopod', 'Single-leg support for sports and event photography'],
    ['C-Stand 40in', 'Heavy-duty stand for lights, flags and backdrops'],
    ['Backdrop Stand Kit', 'Adjustable frame with muslin backdrops for portrait sessions'],
    ['Teleprompter Pad', 'Tablet teleprompter that mounts in front of a camera lens'],
  ],
  Computer: [
    ['MacBook Pro 14 (M3)', 'High-performance laptop for video editing, design and coding'],
    ['MacBook Air 13 (M2)', 'Light laptop for writing, presentations and everyday coursework'],
    ['Lenovo ThinkPad X1 Carbon', 'Business laptop with long battery life for travel'],
    ['HP EliteBook 840', 'Windows laptop with Office installed, for staff on the go'],
    ['Microsoft Surface Laptop 5', 'Touchscreen Windows laptop for note-taking and meetings'],
    ['Dell XPS 15', 'Windows laptop with a dedicated graphics card for creative software'],
    ['Lenovo Chromebook Duet', 'Detachable Chromebook for browsing, docs and video calls'],
    ['ASUS ROG Zephyrus G14', 'Gaming-grade laptop for 3D, game design and simulation work'],
  ],
  Tablet: [
    ['iPad Pro 12.9', 'Large tablet with pencil support for drawing and presentations'],
    ['iPad Air', 'Mid-size tablet for reading, notes and field data collection'],
    ['iPad 10th Gen', 'Basic tablet for kiosks, surveys and check-in desks'],
    ['Samsung Galaxy Tab S9', 'Android tablet with stylus for notes and sketching'],
    ['Wacom Intuos Pro', 'Pen tablet for digital illustration and photo retouching'],
    ['Wacom Cintiq 16', 'Pen display for drawing directly on screen'],
    ['Kindle Paperwhite', 'E-reader for course reading lists'],
    ['reMarkable 2', 'Paper-like tablet for handwritten notes and marking up PDFs'],
  ],
  Presentation: [
    ['Epson PowerLite Projector', 'Bright projector for classrooms and meeting rooms'],
    ['BenQ Portable Projector', 'Small projector for presentations away from the office'],
    ['Anker Nebula Capsule', 'Can-sized projector with a speaker, for movie nights and pop-ups'],
    ['Logitech Spotlight Presenter', 'Wireless clicker with a digital pointer for slide decks'],
    ['Portable Projector Screen 100in', 'Fold-out screen for events without a wall'],
    ['Logitech Rally Bar', 'All-in-one conference camera and speaker for meeting rooms'],
    ['Owl Labs Meeting Owl 3', '360-degree conference camera that follows whoever is speaking'],
    ['Jabra Speak 750', 'Speakerphone for conference calls in small rooms'],
  ],
  'Virtual Reality': [
    ['Meta Quest 3', 'Standalone mixed-reality headset for VR demos and training'],
    ['Meta Quest 2', 'Standalone VR headset for games, tours and simulations'],
    ['HTC Vive Pro 2', 'PC-tethered VR headset with base stations for research labs'],
    ['Valve Index', 'High-end PC VR kit with finger-tracking controllers'],
    ['PlayStation VR2', 'Console VR headset for game design showcases'],
    ['Pico 4', 'Lightweight standalone VR headset'],
    ['Microsoft HoloLens 2', 'Augmented-reality headset that overlays holograms on the room'],
    ['Leap Motion Controller', 'Hand-tracking sensor for gesture interfaces'],
  ],
  Drone: [
    ['DJI Mini 4 Pro', 'Small camera drone for aerial photos of campus and events'],
    ['DJI Air 3', 'Dual-camera drone for aerial video'],
    ['DJI Mavic 3 Classic', 'Professional camera drone for high-quality aerial footage'],
    ['DJI Avata 2', 'First-person-view drone for immersive flying shots'],
    ['Autel EVO Lite+', 'Camera drone with a large sensor for low-light aerial shots'],
    ['Skydio 2+', 'Autonomous drone that follows a subject and avoids obstacles'],
    ['DJI FPV Combo', 'Racing-style drone with goggles'],
    ['Parrot Anafi', 'Folding drone with a zoom camera for inspections'],
  ],
  Maker: [
    ['Prusa MK4 3D Printer', 'Reliable 3D printer for prototypes and class projects'],
    ['Bambu Lab P1S', 'Fast enclosed 3D printer for multi-colour prints'],
    ['Formlabs Form 3+', 'Resin 3D printer for detailed models and jewellery'],
    ['Creality Ender 3 V3', 'Entry-level 3D printer for learning to print'],
    ['Glowforge Laser Cutter', 'Desktop laser for cutting and engraving wood and acrylic'],
    ['Cricut Maker 3', 'Cutting machine for vinyl, paper and fabric crafts'],
    ['Raspberry Pi 5 Kit', 'Single-board computer kit for electronics and coding projects'],
    ['Arduino Uno Starter Kit', 'Microcontroller kit with sensors for beginner electronics'],
  ],
  Tools: [
    ['DeWalt Cordless Drill', 'Battery drill and driver for building sets and repairs'],
    ['Makita Impact Driver', 'Driver for long screws and heavy fixings'],
    ['Bosch Laser Level', 'Cross-line laser for hanging shelves and exhibits straight'],
    ['Fluke 117 Multimeter', 'Meter for checking voltage and continuity on circuits'],
    ['Weller Soldering Station', 'Temperature-controlled iron for electronics work'],
    ['Ryobi Circular Saw', 'Saw for cutting sheet material and lumber'],
    ['Stanley Tool Kit 65pc', 'General hand-tool set for small fixes'],
    ['Werner Step Ladder 6ft', 'Fibreglass ladder for hanging lights and banners'],
  ],
  Lab: [
    ['Celestron NexStar Telescope', 'Computerised telescope for astronomy nights'],
    ['AmScope Compound Microscope', 'Lab microscope for biology slides'],
    [
      'Vernier Go Direct Sensor Kit',
      'Wireless temperature, motion and force sensors for experiments',
    ],
    ['Rigol Oscilloscope', 'Two-channel scope for viewing electronic signals'],
    ['Ohaus Precision Scale', 'Lab balance accurate to a hundredth of a gram'],
    ['FLIR ONE Thermal Camera', 'Phone add-on that shows heat, for energy audits'],
    ['Hach pH Meter', 'Meter for water quality and chemistry labs'],
    ['Kestrel Weather Meter', 'Handheld meter for wind, humidity and temperature in the field'],
  ],
  Event: [
    ['Pop-up Canopy 10x10', 'Shade tent for outdoor fairs and booths'],
    ['Folding Table 6ft', 'Table for registration desks and stalls'],
    ['JBL PartyBox 310', 'Portable PA speaker with lights for outdoor events'],
    ['Bose S1 Pro Speaker', 'Battery PA speaker with mic input for talks outdoors'],
    ['Coleman 4-Person Tent', 'Camping tent for field trips and retreats'],
    ['Yeti Tundra Cooler', 'Hard cooler that keeps food cold for days'],
    ['Jackery Power Station 1000', 'Portable battery for running equipment without mains power'],
    ['Motorola Walkie-Talkie Set', 'Six two-way radios for coordinating event staff'],
  ],
};

/** The tag prefix for each category, for readable unit tags such as `CAM-003-2`. */
const tagPrefix = (category) =>
  category
    .replace(/[^A-Za-z]/g, '')
    .slice(0, 3)
    .toUpperCase();

/** The default size: a full-looking catalogue that stays under AI search's 100-candidate limit. */
const DEFAULT_COUNT = 90;

function parseArgs(argv) {
  const args = { org: 'org-b', remove: false, count: DEFAULT_COUNT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--org') args.org = argv[(i += 1)];
    else if (argv[i] === '--remove') args.remove = true;
    else if (argv[i] === '--count') args.count = Number(argv[(i += 1)]);
  }
  return args;
}

/**
 * The first `count` assets, taken evenly across categories: every category's first item, then every
 * category's second, and so on. Each entry keeps its index within its category, which its unit tags
 * and unit count are derived from, so an asset gets the same tags whatever `count` was.
 * @returns {Array<{ category: string, index: number, name: string, description: string }>}
 */
function pickAssets(count) {
  const picked = [];
  const longest = Math.max(...Object.values(CATALOG).map((items) => items.length));
  for (let index = 0; index < longest && picked.length < count; index += 1) {
    for (const [category, items] of Object.entries(CATALOG)) {
      if (index < items.length && picked.length < count) {
        const [name, description] = items[index];
        picked.push({ category, index, name, description });
      }
    }
  }
  return picked;
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed: NODE_ENV=production.');
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is required to run the seed script.');
    process.exit(1);
  }
  const { org: slug, remove, count } = parseArgs(process.argv.slice(2));
  const available = Object.values(CATALOG).flat().length;
  if (!Number.isInteger(count) || count < 1 || count > available) {
    console.error(`--count must be a whole number from 1 to ${available}.`);
    process.exit(1);
  }

  await connectDb(process.env.MONGODB_URI);
  try {
    const org = await Organization.findOne({ slug });
    if (!org) {
      console.error(`No organization with slug "${slug}". Run \`npm run seed\` first.`);
      process.exit(1);
    }
    const orgId = String(org._id);
    const names = Object.values(CATALOG).flatMap((items) => items.map(([name]) => name));

    if (remove) {
      // `trusted`: the app turns on Mongoose's sanitizeFilter, which strips query operators otherwise.
      const assets = await Asset.find(
        { orgId, name: mongoose.trusted({ $in: names }) },
        { _id: 1 },
      );
      const ids = assets.map((a) => a._id);
      const units = await AssetUnit.deleteMany({ orgId, assetId: mongoose.trusted({ $in: ids }) });
      const deleted = await Asset.deleteMany({ orgId, _id: mongoose.trusted({ $in: ids }) });
      console.log(
        `Removed ${deleted.deletedCount} demo assets and ${units.deletedCount} units from ${slug}.`,
      );
      return;
    }

    const existing = new Set(
      (await Asset.find({ orgId, name: mongoose.trusted({ $in: names }) }, { name: 1 })).map(
        (a) => a.name,
      ),
    );
    let added = 0;
    let unitsAdded = 0;
    for (const { category, index, name, description } of pickAssets(count)) {
      if (existing.has(name)) continue;
      const asset = await assetRepo.create(orgId, { name, category, description });
      const units = (index % 3) + 1;
      for (let n = 1; n <= units; n += 1) {
        await unitRepo.create(orgId, {
          assetId: asset._id,
          tag: `${tagPrefix(category)}-${String(index + 1).padStart(3, '0')}-${n}`,
          status: DEAD_ENDS.has(name) ? UNIT_STATUS.MAINTENANCE : UNIT_STATUS.AVAILABLE,
          condition: 'GOOD',
        });
        unitsAdded += 1;
      }
      added += 1;
    }
    const total = await Asset.countDocuments({ orgId, retiredAt: null });
    console.log(
      `Added ${added} assets and ${unitsAdded} units to ${slug} (${existing.size} already there).`,
    );
    console.log(`${slug} now has ${total} assets in its catalog.`);
    console.log(
      `Dead ends for similar items (every unit in maintenance): ${[...DEAD_ENDS].join(', ')}`,
    );
  } finally {
    await disconnectDb();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
