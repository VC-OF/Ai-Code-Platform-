import {
  demoKeyFor,
  needsKey,
  savedKeyName,
  toSavedKeys,
  type PublicApi,
  type PublicApiWithKey,
  type SavedKeys,
} from './catalog';

/**
 * Hand-written product ideas. Each names the catalog categories it combines;
 * resolveIdea() turns that into concrete APIs for the current catalog and the
 * user's saved keys.
 */
export interface IdeaBlueprint {
  id: string;
  title: string;
  /** One sentence. */
  pitch: string;
  /** Real catalog category names, one API is picked per category. */
  categories: string[];
  features: string[];
  audience: string;
  /**
   * Optional curated shortlist per category (best first) so a recipe app gets
   * a recipe API rather than the category's first no-key API. It narrows the
   * candidates to the shortlist plus every API in the category whose key the
   * user has saved; rankApis() orders those by tier, with shortlist position
   * as the first tie-break. When none of them are in the catalog the whole
   * category is used.
   */
  candidates?: Record<string, string[]>;
}

export interface ResolvedIdeaApi extends PublicApiWithKey {
  needsKey: boolean;
  demoKey?: string;
}

export type IdeaReadiness = 'ready' | 'needs-keys';

export interface ResolvedIdea {
  id: string;
  title: string;
  pitch: string;
  categories: string[];
  features: string[];
  audience: string;
  apis: ResolvedIdeaApi[];
  /** Categories with no usable API (empty unless the catalog changed). */
  missingCategories: string[];
  readiness: IdeaReadiness;
  /** keyEnv names still needed before the idea is ready. */
  neededKeys: string[];
}

export const IDEA_BLUEPRINTS: IdeaBlueprint[] = [
  {
    id: 'travel-planner',
    title: 'Travel planner',
    pitch: 'Plan trips on a day-by-day itinerary with place search, the forecast for each stop and public-transport options.',
    categories: ['Geocoding', 'Weather', 'Transportation'],
    features: [
      'Search destinations and pin them on a day-by-day itinerary',
      'Forecast for every stop on the day you are there',
      'Public-transport connections between stops',
      'Trips saved locally with a shareable read-only view',
    ],
    audience: 'Travellers and weekend-trip planners',
    candidates: {
      Geocoding: ['Nominatim', 'Geoapify', 'OpenCage', 'LocationIQ'],
      Weather: ['Open-Meteo', 'WeatherAPI', 'OpenWeatherMap', 'Visual Crossing'],
      Transportation: ['transport.rest', 'TransitLand', 'Amadeus for Developers'],
    },
  },
  {
    id: 'finance-dashboard',
    title: 'Personal finance dashboard',
    pitch: 'See stocks, cash and crypto in one base currency with live prices and simple budgets.',
    categories: ['Finance', 'Currency Exchange', 'Cryptocurrency'],
    features: [
      'Holdings across stocks, cash and crypto in one base currency',
      'Live FX conversion for multi-currency accounts',
      'Watchlist with daily change and sparklines',
      'Monthly budget categories stored locally',
    ],
    audience: 'Anyone tracking their own money',
    candidates: {
      Finance: ['Alpha Vantage', 'Finnhub', 'Twelve Data', 'Financial Modeling Prep'],
      'Currency Exchange': ['Frankfurter', 'Currency-api', 'ExchangeRate-API'],
      Cryptocurrency: ['CoinGecko', 'Coinpaprika', 'CoinCap'],
    },
  },
  {
    id: 'recipe-planner',
    title: 'Recipe & nutrition planner',
    pitch: 'Find recipes, plan the week and see calories and macros for every meal.',
    categories: ['Food & Drink', 'Health'],
    features: [
      'Recipe search by ingredient, cuisine and category',
      'Drag-and-drop weekly meal plan',
      'Calories and macros per meal and per day',
      'Shopping list generated from the plan',
    ],
    audience: 'Home cooks and meal-preppers',
    candidates: {
      'Food & Drink': ['TheMealDB', 'Spoonacular', 'RecipeAPI', 'Edamam recipes'],
      Health: ['FoodData Central', 'Nutritionix', 'Edamam'],
    },
  },
  {
    id: 'space-explorer',
    title: 'Space explorer',
    pitch: 'Follow upcoming rocket launches, explore the solar system and browse space photography.',
    categories: ['Science & Math', 'Photography'],
    features: [
      'Launch timeline with live countdowns',
      'Mission detail pages with rocket, pad and agency',
      'Space photo wall searchable by object',
      'Favourite launches and photos saved locally',
    ],
    audience: 'Space fans, students and teachers',
    candidates: {
      'Science & Math': ['Launch Library 2', 'Solar System OpenData', 'NASA', 'SpaceX'],
      Photography: ['Pexels', 'Pixabay', 'Unsplash'],
    },
  },
  {
    id: 'sports-tracker',
    title: 'Sports tracker',
    pitch: 'Live scores, fixtures and standings for the teams you follow, with the headlines about them.',
    categories: ['Sports & Fitness', 'News'],
    features: [
      'Live scores and fixtures for followed teams',
      'League standings tables',
      'Team news feed',
      'Match reminders stored locally',
    ],
    audience: 'Fans following several leagues',
    candidates: {
      'Sports & Fitness': ['SportScore', 'TheSportsDB', 'balldontlie', 'OpenLigaDB'],
      News: ['GNews', 'TheNews', 'Currents', 'NewsData'],
    },
  },
  {
    id: 'book-club',
    title: 'Book club',
    pitch: 'Run a reading group around free classics with schedules, notes and an in-app dictionary.',
    categories: ['Books', 'Dictionaries'],
    features: [
      'Pick the monthly read from thousands of free classics',
      'Reading schedule with chapter check-ins',
      'Tap a word to see its definition',
      'Discussion prompts and member notes',
    ],
    audience: 'Book clubs and reading circles',
    candidates: {
      Books: ['Gutendex', 'Open Library', 'Google Books'],
      Dictionaries: ['Free Dictionary', 'Wiktionary', 'Merriam-Webster'],
    },
  },
  {
    id: 'music-discovery',
    title: 'Music discovery',
    pitch: 'Search artists, preview tracks and see who is touring near you.',
    categories: ['Music', 'Events'],
    features: [
      'Artist and album search with 30-second previews',
      'Related-artist exploration',
      'Upcoming concerts for saved artists',
      'Personal crate of saved tracks',
    ],
    audience: 'Listeners who dig for new music',
    candidates: {
      Music: ['iTunes Search', 'MusicBrainz', 'LastFm', 'Deezer'],
      Events: ['Ticketmaster', 'SeatGeek', 'Eventbrite'],
    },
  },
  {
    id: 'job-board',
    title: 'Job board',
    pitch: 'A focused job board with remote filters, a map of openings and an application tracker.',
    categories: ['Jobs', 'Geocoding'],
    features: [
      'Filter roles by tag, company, remote and location',
      'Map view of openings',
      'Saved searches that highlight new jobs',
      'Application tracker board',
    ],
    audience: 'Job seekers and small recruiting teams',
    candidates: {
      Jobs: ['Arbeitnow', 'RemoteOK', 'Adzuna', 'The Muse'],
      Geocoding: ['Nominatim', 'Geoapify', 'OpenCage'],
    },
  },
  {
    id: 'city-dashboard',
    title: 'Open-data city dashboard',
    pitch: 'A civic dashboard with city datasets, quality-of-life scores and live weather.',
    categories: ['Government', 'Open Data', 'Environment'],
    features: [
      'KPI tiles for services, population and quality of life',
      'Dataset browser with charts',
      'Live weather and air-quality panel',
      'Neighbourhood comparison view',
    ],
    audience: 'Civic hackers, journalists and residents',
    candidates: {
      Government: ['City, Toronto Open Data', 'City, New York Open Data', 'Census.gov', 'Data USA'],
      'Open Data': ['Teleport', 'Wikipedia', 'Socrata'],
      Environment: ['Open-Meteo', 'OpenAQ', 'AirNow'],
    },
  },
  {
    id: 'game-companion',
    title: 'Game companion',
    pitch: 'Track PC game deals and free-to-play drops, priced in your own currency.',
    categories: ['Games & Comics', 'Currency Exchange'],
    features: [
      'Deal feed across PC stores',
      'Prices converted to your currency',
      'Wishlist with price-drop badges',
      'Store and genre filters',
    ],
    audience: 'PC gamers hunting for deals',
    candidates: {
      'Games & Comics': ['CheapShark', 'FreeToGame', 'GamerPower', 'RAWG.io'],
      'Currency Exchange': ['Frankfurter', 'Currency-api', 'ExchangeRate-API'],
    },
  },
  {
    id: 'learning-quiz',
    title: 'Learning quiz',
    pitch: 'Timed trivia rounds and mental-math drills with streaks and a local leaderboard.',
    categories: ['Games & Comics', 'Science & Math'],
    features: [
      'Trivia rounds by category and difficulty',
      'Mental-math drills with generated expressions',
      'Streaks, XP and a local leaderboard',
      'Review mode for missed questions',
    ],
    audience: 'Students and quiz lovers',
    candidates: {
      'Games & Comics': ['Open Trivia', 'quizapi.io'],
      'Science & Math': ['xMath', 'Numbers'],
    },
  },
  {
    id: 'event-planner',
    title: 'Weather-aware event planner',
    pitch: 'Find events, check the forecast for the day and avoid clashes with public holidays.',
    categories: ['Events', 'Weather', 'Calendar'],
    features: [
      'Discover events and add them to a planner',
      'Forecast and rain risk for each event day',
      'Public holidays and long weekends flagged',
      'Export the plan as an .ics file',
    ],
    audience: 'Social planners and small event teams',
    candidates: {
      Events: ['Ticketmaster', 'SeatGeek', 'Eventbrite'],
      Weather: ['Open-Meteo', 'WeatherAPI', 'OpenWeatherMap'],
      Calendar: ['caldays', 'Nager.Date', 'Calendarific'],
    },
  },
  {
    id: 'crypto-portfolio',
    title: 'Crypto portfolio',
    pitch: 'Track coins and wallets with live prices, profit and loss, and fiat conversion.',
    categories: ['Cryptocurrency', 'Blockchain', 'Currency Exchange'],
    features: [
      'Holdings with live prices, P&L and allocation chart',
      'Wallet address lookup',
      'Values in any fiat currency',
      'Price alerts stored locally',
    ],
    audience: 'Crypto holders',
    candidates: {
      Cryptocurrency: ['CoinGecko', 'Coinpaprika', 'CoinCap', 'CoinMarketCap'],
      Blockchain: ['Etherscan', 'Blockscout', 'Covalent'],
      'Currency Exchange': ['Frankfurter', 'Currency-api'],
    },
  },
  {
    id: 'news-digest',
    title: 'News digest',
    pitch: 'A calm daily digest of headlines grouped by topic, translated into your language.',
    categories: ['News', 'Text Analysis'],
    features: [
      'Morning digest grouped by topic',
      'Translate any story into your language',
      'Mute sources and keywords',
      'Reading list available offline',
    ],
    audience: 'Busy readers who want less noise',
    candidates: {
      News: ['Noozra', 'GNews', 'TheNews', 'Currents', 'The Guardian'],
      'Text Analysis': ['LibreTranslate', 'Kiprio Translate', 'Langbly'],
    },
  },
  {
    id: 'dev-status-page',
    title: 'Developer status page',
    pitch: 'One page for provider outages, your CI builds and your packages’ badges.',
    categories: ['Development', 'Continuous Integration', 'Open Source Projects'],
    features: [
      'Live status and incidents for the cloud providers you use',
      'Latest CI build per repository',
      'Release and dependency badges',
      'Public status page with an RSS feed',
    ],
    audience: 'Small engineering teams',
    candidates: {
      Development: ['OutageDeck', 'DownStatus', 'Is This Site Down?', 'DigitalOcean Status'],
      'Continuous Integration': ['CircleCI', 'Travis CI', 'Bitrise'],
      'Open Source Projects': ['Shields', 'Libraries.io'],
    },
  },
  {
    id: 'anime-tracker',
    title: 'Anime & entertainment tracker',
    pitch: 'Seasonal anime charts, movie and series lookup, and your watch progress in one place.',
    categories: ['Anime', 'Video'],
    features: [
      'Seasonal anime chart and watchlist',
      'Movie and series lookup with ratings',
      'Episode progress tracker',
      'Recommendations by genre',
    ],
    audience: 'Anime and TV fans',
    candidates: {
      Anime: ['Jikan', 'AniList', 'Kitsu'],
      Video: ['IMDbOT', 'TVMaze', 'TMDb', 'Trakt'],
    },
  },
  {
    id: 'pet-adoption',
    title: 'Pet adoption finder',
    pitch: 'Browse adoptable pets near you with shelter details and an adoption checklist.',
    categories: ['Animals', 'Geocoding'],
    features: [
      'Search adoptable pets by species, age and distance',
      'Pet profiles with photos and shelter contact',
      'Map of nearby shelters',
      'Favourites and an adoption checklist',
    ],
    audience: 'Future pet owners and rescue volunteers',
    candidates: {
      Animals: ['RescueGroups', 'The Dog', 'Cats'],
      Geocoding: ['Nominatim', 'Zippopotam.us', 'Geoapify'],
    },
  },
  {
    id: 'fitness-log',
    title: 'Health & fitness log',
    pitch: 'Log workouts from an exercise library alongside a food diary with calories and macros.',
    categories: ['Sports & Fitness', 'Health'],
    features: [
      'Workout log from an exercise library',
      'Food diary with calories and macros',
      'Weekly trends and personal records',
      'Goals with streak tracking',
    ],
    audience: 'People building a training habit',
    candidates: {
      'Sports & Fitness': ['Wger', 'Strava', 'Fitbit'],
      Health: ['Nutritionix', 'FoodData Central', 'Edamam'],
    },
  },
  {
    id: 'language-learning',
    title: 'Language learning',
    pitch: 'Daily vocabulary cards with definitions, translations and spaced repetition.',
    categories: ['Dictionaries', 'Text Analysis'],
    features: [
      'Daily vocabulary cards with spaced repetition',
      'Instant phrase translation',
      'Definitions, examples and pronunciation',
      'Progress stats per language',
    ],
    audience: 'Self-taught language learners',
    candidates: {
      Dictionaries: ['Wiktionary', 'Free Dictionary', 'Lingua Robot'],
      'Text Analysis': ['LibreTranslate', 'Kiprio Translate', 'Langbly', 'Lecto Translation'],
    },
  },
  {
    id: 'art-gallery',
    title: 'Art gallery',
    pitch: 'An endless gallery of museum artworks with artist bios and personal collections.',
    categories: ['Art & Design', 'Open Data'],
    features: [
      'Infinite gallery of public-domain artworks',
      'Filter by era, medium and artist',
      'Artist bios from Wikipedia',
      'Personal collections and slideshow mode',
    ],
    audience: 'Art lovers, students and teachers',
    candidates: {
      'Art & Design': ['Art Institute of Chicago', 'Metropolitan Museum of Art', 'Rijksmuseum', 'Harvard Art Museums'],
      'Open Data': ['Wikipedia', 'Wikidata'],
    },
  },
  {
    id: 'air-quality',
    title: 'Air-quality monitor',
    pitch: 'Live air quality and pollution forecasts for the places you care about.',
    categories: ['Environment', 'Geocoding'],
    features: [
      'Live AQI, PM2.5 and ozone for any city',
      'Hourly pollution forecast chart',
      'Health guidance by AQI band',
      'Saved locations compared side by side',
    ],
    audience: 'Runners, parents and people with asthma',
    candidates: {
      Environment: ['Open-Meteo', 'OpenAQ', 'AirNow', 'IQAir'],
      Geocoding: ['Nominatim', 'Geoapify', 'OpenCage'],
    },
  },
  {
    id: 'security-toolkit',
    title: 'Security toolkit',
    pitch: 'Look up CVEs and check suspicious URLs against malware blocklists from one console.',
    categories: ['Security', 'Anti-Malware'],
    features: [
      'CVE search with severity scores',
      'URL checks against malware blocklists',
      'Scan history with notes',
      'Exportable reports',
    ],
    audience: 'Developers and IT admins',
    candidates: {
      Security: ['National Vulnerability Database', 'SSL Labs', 'Mozilla http scanner', 'HaveIBeenPwned'],
      'Anti-Malware': ['URLhaus', 'VirusTotal', 'Google Safe Browsing'],
    },
  },
  {
    id: 'price-tracker',
    title: 'Shopping price tracker',
    pitch: 'Track products, chart their price history and get told when they hit your target price.',
    categories: ['Shopping', 'Currency Exchange'],
    features: [
      'Tracked products with price-history charts',
      'Target-price alerts',
      'Prices compared in your currency',
      'Wishlist grouped by store',
    ],
    audience: 'Deal hunters and careful shoppers',
    candidates: {
      Shopping: ['Best Buy', 'CartScout', 'eBay'],
      'Currency Exchange': ['Frankfurter', 'Currency-api', 'ExchangeRate-API'],
    },
  },
  {
    id: 'holiday-calendar',
    title: 'Calendar & holidays',
    pitch: 'Public holidays for every country in a year view, with a long-weekend finder.',
    categories: ['Calendar', 'Geocoding'],
    features: [
      'Year view of public holidays by country',
      'Long-weekend finder',
      'Compare holidays across countries',
      'Export to your calendar (.ics)',
    ],
    audience: 'Remote teams and holiday planners',
    candidates: {
      Calendar: ['caldays', 'Nager.Date', 'Calendarific'],
      Geocoding: ['REST Countries', 'Country'],
    },
  },
];

// ─── Resolution ─────────────────────────────────────────────────────────────

/**
 * Lower is better: no key + HTTPS + CORS (0), an API key the user already
 * saved (1), other no-key APIs over HTTPS (2) then plain HTTP (3), unusual
 * auth (4), unsaved API keys (5), OAuth with a saved credential (6), OAuth (7).
 */
export function apiTier(api: PublicApi, saved: SavedKeys): number {
  const keySaved = savedKeyName(api, saved) !== null;
  switch (api.authKind) {
    case 'none':
      return api.https && api.cors === 'yes' ? 0 : api.https ? 2 : 3;
    case 'apiKey':
      return keySaved ? 1 : 5;
    case 'other':
      return 4;
    case 'oauth':
      return keySaved ? 6 : 7;
  }
}

const CORS_RANK = { yes: 0, unknown: 1, no: 2 } as const;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Deterministic best-first order; `shortlist` ranks curated names within a tier. */
export function rankApis(apis: readonly PublicApi[], saved: SavedKeys, shortlist: readonly string[] = []): PublicApi[] {
  const listed = shortlist.map((name) => name.toLowerCase());
  const pos = (api: PublicApi) => {
    const i = listed.indexOf(api.name.toLowerCase());
    return i === -1 ? listed.length : i;
  };
  return [...apis].sort(
    (a, b) =>
      apiTier(a, saved) - apiTier(b, saved) ||
      pos(a) - pos(b) ||
      Number(b.https) - Number(a.https) ||
      CORS_RANK[a.cors] - CORS_RANK[b.cors] ||
      compareText(a.name.toLowerCase(), b.name.toLowerCase()) ||
      a.id - b.id
  );
}

const categoryIndexCache = new WeakMap<readonly PublicApi[], Map<string, PublicApi[]>>();

function byCategory(catalog: readonly PublicApi[]): Map<string, PublicApi[]> {
  let index = categoryIndexCache.get(catalog);
  if (!index) {
    index = new Map();
    for (const api of catalog) {
      const list = index.get(api.category);
      if (list) list.push(api);
      else index.set(api.category, [api]);
    }
    categoryIndexCache.set(catalog, index);
  }
  return index;
}

export function resolveIdea(
  blueprint: IdeaBlueprint,
  catalog: readonly PublicApi[],
  savedKeyEnvs: Iterable<string> | SavedKeys = []
): ResolvedIdea {
  const saved = toSavedKeys(savedKeyEnvs);
  const index = byCategory(catalog);
  const usedNames = new Set<string>();
  const apis: ResolvedIdeaApi[] = [];
  const missingCategories: string[] = [];

  for (const category of blueprint.categories) {
    const inCategory = index.get(category) ?? [];
    const shortlist = blueprint.candidates?.[category] ?? [];
    const listed = new Set(shortlist.map((name) => name.toLowerCase()));
    const unused = (list: PublicApi[]) => list.filter((api) => !usedNames.has(api.name.toLowerCase()));
    // A saved key always competes, so it can unlock the idea even when its API is not shortlisted
    const eligible = (api: PublicApi) => listed.has(api.name.toLowerCase()) || savedKeyName(api, saved) !== null;

    let pool = unused(listed.size ? inCategory.filter(eligible) : inCategory);
    if (!pool.length) pool = unused(inCategory);

    const best = rankApis(pool, saved, shortlist)[0];
    if (!best) {
      missingCategories.push(category);
      continue;
    }
    usedNames.add(best.name.toLowerCase());
    const savedAs = savedKeyName(best, saved);
    const demoKey = needsKey(best) ? demoKeyFor(best.keyEnv) : undefined;
    apis.push({
      ...best,
      keySaved: savedAs !== null,
      ...(savedAs ? { keySavedAs: savedAs } : {}),
      needsKey: needsKey(best),
      ...(demoKey ? { demoKey } : {}),
    });
  }

  const neededKeys = Array.from(new Set(apis.filter((api) => api.needsKey && !api.keySaved).map((api) => api.keyEnv)));
  return {
    id: blueprint.id,
    title: blueprint.title,
    pitch: blueprint.pitch,
    categories: [...blueprint.categories],
    features: [...blueprint.features],
    audience: blueprint.audience,
    apis,
    missingCategories,
    readiness: neededKeys.length ? 'needs-keys' : 'ready',
    neededKeys,
  };
}

export function resolveIdeas(
  catalog: readonly PublicApi[],
  savedKeyEnvs: Iterable<string> | SavedKeys = [],
  blueprints: readonly IdeaBlueprint[] = IDEA_BLUEPRINTS
): ResolvedIdea[] {
  const saved = toSavedKeys(savedKeyEnvs);
  return blueprints.map((blueprint) => resolveIdea(blueprint, catalog, saved));
}
