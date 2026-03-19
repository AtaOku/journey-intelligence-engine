/**
 * CSV Parser & Sessionizer
 * 
 * Parses uploaded CSV files into session objects.
 * Handles multiple CSV formats:
 *   - Our standard format: session_id, timestamp, event_type, category, product_id, price
 *   - REES46 format: event_time, event_type, product_id, category_code, brand, price, user_id, user_session
 *   - GA4-like format: session_id, event_name, page_location, ...
 * 
 * Auto-detects format from column headers.
 */

export interface RawEvent {
  session_id: string;
  timestamp: number;
  event_type: string;
  category: string;
  product_id: string;
  price: number;
}

export interface ProcessedSession {
  session_id: string;
  events: string[];
  converted: boolean;
  n_events: number;
  categories: string[];
  total_value: number;
}

// ---- CSV Parsing ----

export function parseCSV(csvText: string): Record<string, string>[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));

  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (values[i] || '').trim().replace(/^"|"$/g, '');
    });
    return row;
  });
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// ---- Format Detection ----

type CSVFormat = 'standard' | 'rees46' | 'ga4' | 'shopify' | 'unknown';

function detectFormat(headers: string[]): CSVFormat {
  const headerSet = new Set(headers.map((h) => h.toLowerCase()));

  // GA4 BigQuery export: event_name + ga_session_id (or session_id + event_name)
  if (headerSet.has('event_name') && (headerSet.has('ga_session_id') || headerSet.has('session_id'))) {
    return 'ga4';
  }
  // Shopify: order_id or checkout_token with event columns
  if ((headerSet.has('checkout_token') || headerSet.has('order_name')) && headerSet.has('landing_site')) {
    return 'shopify';
  }
  // REES46
  if (headerSet.has('user_session') && headerSet.has('event_type')) {
    return 'rees46';
  }
  // Standard
  if (headerSet.has('session_id') && headerSet.has('event_type')) {
    return 'standard';
  }
  return 'unknown';
}

// ---- Column Mapping ----

const COLUMN_MAPS: Record<CSVFormat, Record<string, string>> = {
  standard: {
    session_id: 'session_id',
    timestamp: 'timestamp',
    event_type: 'event_type',
    category: 'category',
    product_id: 'product_id',
    price: 'price',
  },
  rees46: {
    session_id: 'user_session',
    timestamp: 'event_time',
    event_type: 'event_type',
    category: 'category_code',
    product_id: 'product_id',
    price: 'price',
  },
  ga4: {
    session_id: 'ga_session_id',
    timestamp: 'event_timestamp',
    event_type: 'event_name',
    category: 'page_location',
    product_id: 'item_id',
    price: 'value',
  },
  shopify: {
    session_id: 'checkout_token',
    timestamp: 'created_at',
    event_type: 'event_type',
    category: 'product_type',
    product_id: 'product_id',
    price: 'total_price',
  },
  unknown: {},
};

// REES46 event type mapping
const REES46_EVENT_MAP: Record<string, string> = {
  view: 'view',
  cart: 'add_to_cart',
  purchase: 'purchase',
  remove_from_cart: 'cart_edit',
};

// GA4 event name → journey step mapping
const GA4_EVENT_MAP: Record<string, string> = {
  page_view: 'view',
  session_start: 'homepage',
  view_item: 'view',
  view_item_list: 'category',
  select_item: 'view',
  view_search_results: 'search',
  add_to_cart: 'add_to_cart',
  remove_from_cart: 'cart_edit',
  view_cart: 'cart',
  begin_checkout: 'checkout',
  add_payment_info: 'payment',
  add_shipping_info: 'checkout',
  purchase: 'purchase',
};

// ---- Main Processing ----

export function processUploadedCSV(csvText: string): {
  sessions: ProcessedSession[];
  format: CSVFormat;
  totalEvents: number;
  warnings: string[];
} {
  const warnings: string[] = [];
  const rows = parseCSV(csvText);

  if (rows.length === 0) {
    return { sessions: [], format: 'unknown', totalEvents: 0, warnings: ['Empty CSV file'] };
  }

  const headers = Object.keys(rows[0]);
  const format = detectFormat(headers);

  if (format === 'unknown') {
    warnings.push(
      `Could not detect CSV format. Supported: standard (session_id + event_type), REES46 (user_session + event_type), GA4 BigQuery (ga_session_id + event_name), Shopify (checkout_token + landing_site). Found columns: ${headers.slice(0, 8).join(', ')}${headers.length > 8 ? '...' : ''}`
    );
    return { sessions: [], format, totalEvents: rows.length, warnings };
  }

  const colMap = COLUMN_MAPS[format];

  // Convert rows to RawEvents
  const events: RawEvent[] = [];
  let parseErrors = 0;

  for (const row of rows) {
    try {
      // GA4 exports may use ga_session_id or session_id
      let sessionId = row[colMap.session_id];
      if (!sessionId && format === 'ga4') {
        sessionId = row['session_id'] || row['ga_session_id'];
      }
      if (!sessionId) { parseErrors++; continue; }

      let eventType = row[colMap.event_type] || 'unknown';
      if (format === 'rees46') {
        eventType = REES46_EVENT_MAP[eventType] || eventType;
      } else if (format === 'ga4') {
        eventType = GA4_EVENT_MAP[eventType] || eventType;
      }

      let timestamp = 0;
      const tsRaw = row[colMap.timestamp];
      if (tsRaw) {
        // GA4 event_timestamp is in microseconds
        const asNum = Number(tsRaw);
        if (format === 'ga4' && !isNaN(asNum) && asNum > 1e15) {
          timestamp = asNum / 1000; // microseconds → milliseconds
        } else {
          const d = new Date(tsRaw);
          timestamp = isNaN(d.getTime()) ? 0 : d.getTime();
        }
      }

      const categoryRaw = row[colMap.category] || 'unknown';
      // GA4: extract category from page_location URL path
      let category = categoryRaw;
      if (format === 'ga4' && categoryRaw.startsWith('http')) {
        try {
          const path = new URL(categoryRaw).pathname;
          const segments = path.split('/').filter(Boolean);
          category = segments.slice(0, 2).join('/') || 'homepage';
        } catch {
          category = 'unknown';
        }
      } else {
        category = categoryRaw.split('.').slice(0, 2).join('.');
      }
      const productId = row[colMap.product_id] || '';
      const price = parseFloat(row[colMap.price]) || 0;

      events.push({
        session_id: sessionId,
        timestamp,
        event_type: eventType,
        category,
        product_id: productId,
        price,
      });
    } catch {
      parseErrors++;
    }
  }

  if (parseErrors > 0) {
    warnings.push(`${parseErrors} rows could not be parsed and were skipped.`);
  }

  // Deduplicate: same session + timestamp + event_type
  const beforeDedup = events.length;
  const seen = new Set<string>();
  const dedupedEvents: RawEvent[] = [];
  for (const e of events) {
    const key = `${e.session_id}|${e.timestamp}|${e.event_type}`;
    if (!seen.has(key)) {
      seen.add(key);
      dedupedEvents.push(e);
    }
  }
  const dupsRemoved = beforeDedup - dedupedEvents.length;
  if (dupsRemoved > 0) {
    warnings.push(`${dupsRemoved} duplicate events removed.`);
  }

  // Group into sessions
  const sessionMap = new Map<string, RawEvent[]>();
  for (const event of dedupedEvents) {
    const existing = sessionMap.get(event.session_id) || [];
    existing.push(event);
    sessionMap.set(event.session_id, existing);
  }

  // Process sessions
  const sessions: ProcessedSession[] = [];

  for (const [sessionId, sessionEvents] of sessionMap) {
    // Sort by timestamp
    sessionEvents.sort((a, b) => a.timestamp - b.timestamp);

    const eventTypes = sessionEvents.map((e) => e.event_type);
    const converted = eventTypes.includes('purchase');
    const categories = [...new Set(sessionEvents.map((e) => e.category))];
    const totalValue = sessionEvents.reduce((sum, e) => sum + e.price, 0);

    sessions.push({
      session_id: sessionId,
      events: eventTypes,
      converted,
      n_events: eventTypes.length,
      categories,
      total_value: Math.round(totalValue * 100) / 100,
    });
  }

  return {
    sessions,
    format,
    totalEvents: events.length,
    warnings,
  };
}
