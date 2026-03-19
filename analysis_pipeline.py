"""
Journey Intelligence Engine — Analysis Pipeline
=================================================
Day 1-2 deliverable: process e-commerce clickstream data into showcase_data.json

Usage:
  1. With Kaggle REES46 data:
     python analysis_pipeline.py --source rees46 --input 2019-Oct.csv --sample 10000

  2. With synthetic data (no download needed):
     python analysis_pipeline.py --source synthetic --sessions 10000

  3. Output: showcase_data.json (ready for React app)
"""

import pandas as pd
import numpy as np
from collections import Counter, defaultdict
from itertools import combinations
import json
import argparse
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass, asdict
import hashlib
import warnings
warnings.filterwarnings('ignore')

# ============================================================
# SECTION 1: DATA MODELS
# ============================================================

@dataclass
class SessionEvent:
    session_id: str
    timestamp: float  # unix timestamp
    event_type: str   # view, cart, purchase (REES46) or our taxonomy
    category: str
    product_id: str
    price: float

@dataclass 
class ProcessedSession:
    session_id: str
    events: List[str]        # sequence of event_type steps
    converted: bool          # did session end in purchase?
    n_events: int
    categories: List[str]
    total_value: float       # sum of prices viewed/carted

# Step-type zone classification (for anomaly scoring)
ZONE_CLASSIFICATION = {
    'navigation': ['homepage', 'category', 'search', 'landing'],
    'engagement': ['view', 'pdp', 'review', 'size_guide', 'filter', 'wishlist', 'compare'],
    'commitment': ['cart', 'add_to_cart', 'cart_edit', 'checkout', 'payment', 'purchase'],
}

def get_zone(step: str) -> str:
    """Classify a step into its funnel zone."""
    step_lower = step.lower()
    for zone, steps in ZONE_CLASSIFICATION.items():
        if any(s in step_lower for s in steps):
            return zone
    return 'unknown'  # unrecognized steps scored within their own peer group


# ============================================================
# SECTION 2: REES46 DATA PROCESSOR
# ============================================================

def load_rees46(filepath: str, sample_sessions: int = 10000) -> pd.DataFrame:
    """
    Load and process REES46 multi-category store dataset.
    
    REES46 schema:
    - event_time: timestamp (UTC)
    - event_type: 'view' | 'cart' | 'purchase'  
    - product_id: int
    - category_id: int
    - category_code: str (e.g., 'electronics.smartphone')
    - brand: str
    - price: float
    - user_id: int
    - user_session: str (session identifier)
    """
    print(f"Loading REES46 data from {filepath}...")
    
    # Read only needed columns to save memory
    cols = ['event_time', 'event_type', 'product_id', 'category_code', 
            'price', 'user_id', 'user_session']
    
    # For large files, read in chunks
    chunks = []
    for chunk in pd.read_csv(filepath, usecols=cols, chunksize=500_000,
                              parse_dates=['event_time']):
        chunks.append(chunk)
        if sum(c.shape[0] for c in chunks) > 5_000_000:
            break  # cap at 5M rows for processing speed
    
    df = pd.concat(chunks, ignore_index=True)
    print(f"  Loaded {len(df):,} events")
    
    # Clean
    df = df.dropna(subset=['user_session', 'event_type'])
    df['category'] = df['category_code'].fillna('unknown').apply(
        lambda x: x.split('.')[0] if isinstance(x, str) else 'unknown'
    )
    df['price'] = df['price'].fillna(0)
    df['product_id'] = df['product_id'].fillna(0).astype(str)
    
    # Sort by session + time
    df = df.sort_values(['user_session', 'event_time'])
    
    # Event enrichment happens after sampling (see below)
    
    # Sample sessions (stratified by conversion)
    sessions_with_purchase = df.groupby('user_session')['event_type'].apply(
        lambda x: 'purchase' in x.values
    )
    converting_sessions = sessions_with_purchase[sessions_with_purchase].index
    non_converting_sessions = sessions_with_purchase[~sessions_with_purchase].index
    
    # Maintain realistic conversion rate (~2-3%)
    n_converting = min(len(converting_sessions), int(sample_sessions * 0.03))
    n_non_converting = sample_sessions - n_converting
    
    sampled_converting = np.random.choice(converting_sessions, 
                                           size=min(n_converting, len(converting_sessions)), 
                                           replace=False)
    sampled_non_converting = np.random.choice(non_converting_sessions,
                                               size=min(n_non_converting, len(non_converting_sessions)),
                                               replace=False)
    
    sampled_sessions = np.concatenate([sampled_converting, sampled_non_converting])
    df = df[df['user_session'].isin(sampled_sessions)]
    
    print(f"  Sampled {len(sampled_sessions):,} sessions ({len(sampled_converting)} converting)")
    
    # Rename session/time columns first
    df = df.rename(columns={
        'user_session': 'session_id',
        'event_time': 'timestamp',
    })
    
    # --- ENRICHMENT: Infer journey steps from behavioral patterns ---
    # REES46 only has view/cart/purchase. We enrich to realistic e-commerce steps.
    rng = np.random.RandomState(42)
    enriched_rows = []
    
    for session_id, group in df.groupby('session_id'):
        group = group.sort_values('timestamp').reset_index(drop=True)
        events = list(group['event_type'])
        categories = list(group['category'])
        product_ids = list(group['product_id'])
        prices = list(group['price'])
        timestamps = list(group['timestamp'])
        
        steps = []
        prev_category = None
        view_count = 0
        has_cart = 'cart' in events
        cart_seen = False
        
        for idx, (evt, cat, pid, price, ts) in enumerate(zip(events, categories, product_ids, prices, timestamps)):
            if evt == 'purchase':
                if cart_seen:
                    steps.append({'session_id': session_id, 'timestamp': ts,
                        'event_type': 'checkout', 'category': cat,
                        'product_id': pid, 'price': 0})
                steps.append({'session_id': session_id, 'timestamp': ts,
                    'event_type': 'purchase', 'category': cat,
                    'product_id': pid, 'price': price})
                continue
                
            if evt == 'cart':
                steps.append({'session_id': session_id, 'timestamp': ts,
                    'event_type': 'add_to_cart', 'category': cat,
                    'product_id': pid, 'price': price})
                cart_seen = True
                continue
            
            # evt == 'view' — enrich based on position and behavior
            view_count += 1
            
            if idx == 0:
                r = rng.random()
                step = 'homepage' if r < 0.55 else ('category' if r < 0.80 else 'search')
            elif cat != prev_category and prev_category is not None:
                step = 'category' if rng.random() < 0.6 else 'search'
            elif view_count >= 5 and not has_cart and rng.random() < 0.15:
                step = 'wishlist' if rng.random() < 0.5 else 'size_guide'
            elif view_count >= 3 and rng.random() < 0.1:
                step = 'review'
            else:
                step = 'view'
            
            steps.append({'session_id': session_id, 'timestamp': ts,
                'event_type': step, 'category': cat,
                'product_id': pid, 'price': price})
            prev_category = cat
        
        enriched_rows.extend(steps)
    
    df = pd.DataFrame(enriched_rows)
    
    step_counts = df['event_type'].value_counts()
    print(f"  Enriched to {len(step_counts)} step types:")
    for step, count in step_counts.head(12).items():
        print(f"    {step}: {count:,} ({count/len(df)*100:.1f}%)")
    
    return df[['session_id', 'timestamp', 'event_type', 'category', 'product_id', 'price']]


# ============================================================
# SECTION 3: SYNTHETIC DATA GENERATOR
# ============================================================

def generate_synthetic_data(n_sessions: int = 10000, seed: int = 42) -> pd.DataFrame:
    """
    Generate realistic e-commerce clickstream data.
    
    Distributions based on:
    - Baymard Institute: avg e-commerce CR ~2.5-3.5%
    - Contentsquare 2024 Digital Experience Benchmarks
    - Typical fashion e-commerce funnel (Zalando/ASOS patterns)
    
    Key design: sessions follow probabilistic journey paths, not random walks.
    Deliberate friction points embedded for showcase.
    """
    np.random.seed(seed)
    
    # ---- Journey path templates with probabilities ----
    # Each template: (path, probability, conversion_rate)
    # Probabilities sum to 1.0, represent how likely a session follows this template
    
    JOURNEY_TEMPLATES = [
        # Happy paths (converting)
        {
            'path': ['homepage', 'category', 'view', 'add_to_cart', 'checkout', 'purchase'],
            'weight': 0.06,
            'conversion_rate': 0.42,
            'name': 'direct_browse_purchase'
        },
        {
            'path': ['homepage', 'category', 'view', 'view', 'add_to_cart', 'checkout', 'purchase'],
            'weight': 0.04,
            'conversion_rate': 0.35,
            'name': 'browse_compare_purchase'
        },
        {
            'path': ['homepage', 'search', 'view', 'add_to_cart', 'checkout', 'purchase'],
            'weight': 0.03,
            'conversion_rate': 0.28,
            'name': 'search_direct_purchase'
        },
        {
            'path': ['landing', 'view', 'add_to_cart', 'checkout', 'purchase'],
            'weight': 0.02,
            'conversion_rate': 0.38,
            'name': 'landing_quick_purchase'
        },
        
        # Browse but no buy (non-converting, healthy exploration)
        {
            'path': ['homepage', 'category', 'view'],
            'weight': 0.15,
            'conversion_rate': 0.0,
            'name': 'browse_single_view'
        },
        {
            'path': ['homepage', 'category', 'view', 'view'],
            'weight': 0.10,
            'conversion_rate': 0.0,
            'name': 'browse_compare'
        },
        {
            'path': ['homepage', 'category', 'view', 'category', 'view'],
            'weight': 0.08,
            'conversion_rate': 0.0,
            'name': 'bounce_back_browse'
        },
        
        # FRICTION: Search frustration loop (high volume, very low conversion)
        {
            'path': ['homepage', 'search', 'view', 'search', 'view', 'search'],
            'weight': 0.09,
            'conversion_rate': 0.008,
            'name': 'search_frustration_loop'
        },
        {
            'path': ['search', 'view', 'search', 'view'],
            'weight': 0.05,
            'conversion_rate': 0.005,
            'name': 'search_frustration_direct'
        },
        
        # FRICTION: Cart hesitation (high cart abandonment)
        {
            'path': ['homepage', 'category', 'view', 'add_to_cart', 'view', 'add_to_cart'],
            'weight': 0.06,
            'conversion_rate': 0.02,
            'name': 'cart_hesitation'
        },
        {
            'path': ['homepage', 'search', 'view', 'add_to_cart'],
            'weight': 0.07,
            'conversion_rate': 0.04,
            'name': 'cart_abandon_search'
        },
        
        # FRICTION: Checkout abandonment
        {
            'path': ['homepage', 'category', 'view', 'add_to_cart', 'checkout'],
            'weight': 0.05,
            'conversion_rate': 0.0,
            'name': 'checkout_abandon'
        },
        
        # Bounce (single page exit)
        {
            'path': ['homepage'],
            'weight': 0.10,
            'conversion_rate': 0.0,
            'name': 'homepage_bounce'
        },
        {
            'path': ['landing'],
            'weight': 0.06,
            'conversion_rate': 0.0,
            'name': 'landing_bounce'
        },
        
        # Deep browse, no action
        {
            'path': ['homepage', 'category', 'view', 'view', 'view', 'category', 'view'],
            'weight': 0.04,
            'conversion_rate': 0.0,
            'name': 'deep_browse_no_action'
        },
    ]
    
    # Normalize weights
    total_weight = sum(t['weight'] for t in JOURNEY_TEMPLATES)
    for t in JOURNEY_TEMPLATES:
        t['weight'] /= total_weight
    
    # ---- Product catalog (simplified) ----
    CATEGORIES = ['clothing', 'shoes', 'accessories', 'sportswear', 'beauty']
    CATEGORY_PRICES = {
        'clothing': (25, 150),
        'shoes': (40, 200),
        'accessories': (10, 80),
        'sportswear': (30, 120),
        'beauty': (8, 60),
    }
    
    # ---- Generate sessions ----
    all_events = []
    
    for i in range(n_sessions):
        # Pick a journey template
        template = np.random.choice(JOURNEY_TEMPLATES, 
                                     p=[t['weight'] for t in JOURNEY_TEMPLATES])
        
        # Determine if this session converts
        converted = np.random.random() < template['conversion_rate']
        
        # Build the path
        path = list(template['path'])
        if not converted and path[-1] == 'purchase':
            # Remove purchase (and possibly checkout) from non-converting sessions
            path = path[:-1]
            if path and path[-1] == 'checkout':
                pass  # keep checkout to show checkout abandonment
        
        # Assign session metadata
        session_id = f"s_{i:06d}"
        category = np.random.choice(CATEGORIES)
        price_range = CATEGORY_PRICES[category]
        base_time = 1577836800 + np.random.randint(0, 15552000)  # 2020-01-01 to 2020-07-01
        
        for j, step in enumerate(path):
            product_id = f"p_{np.random.randint(1000, 9999)}" if step in ['view', 'add_to_cart', 'purchase'] else ""
            price = round(np.random.uniform(*price_range), 2) if step in ['view', 'add_to_cart', 'purchase'] else 0
            
            all_events.append({
                'session_id': session_id,
                'timestamp': pd.Timestamp.fromtimestamp(base_time + j * np.random.randint(10, 300)),
                'event_type': step,
                'category': category,
                'product_id': product_id,
                'price': price,
            })
    
    df = pd.DataFrame(all_events)
    
    # Stats
    sessions = df.groupby('session_id')
    n_converting = sessions['event_type'].apply(lambda x: 'purchase' in x.values).sum()
    print(f"Generated {n_sessions:,} sessions, {n_converting} converting ({n_converting/n_sessions*100:.1f}% CR)")
    
    return df


# ============================================================
# SECTION 4: SESSION PROCESSING
# ============================================================

def process_sessions(df: pd.DataFrame) -> List[ProcessedSession]:
    """Convert raw events into processed session objects."""
    sessions = []
    
    for session_id, group in df.groupby('session_id'):
        group = group.sort_values('timestamp')
        events = list(group['event_type'])
        converted = 'purchase' in events
        categories = list(group['category'].unique())
        total_value = group['price'].sum()
        
        sessions.append(ProcessedSession(
            session_id=str(session_id),
            events=events,
            converted=converted,
            n_events=len(events),
            categories=categories,
            total_value=round(total_value, 2)
        ))
    
    return sessions


# ============================================================
# SECTION 5: TRANSITION MATRIX (Markov Chain)
# ============================================================

def compute_transition_matrix(sessions: List[ProcessedSession], 
                                filter_converted: Optional[bool] = None) -> Dict:
    """
    Compute first-order Markov transition matrix.
    P(next_step | current_step) from all sessions.
    
    Returns dict of dicts: {from_step: {to_step: probability}}
    """
    transition_counts = defaultdict(Counter)
    
    for session in sessions:
        if filter_converted is not None and session.converted != filter_converted:
            continue
        
        # Add session start marker
        steps = ['[start]'] + session.events + ['[exit]']
        
        for i in range(len(steps) - 1):
            transition_counts[steps[i]][steps[i + 1]] += 1
    
    # Normalize to probabilities
    transition_matrix = {}
    for from_step, targets in transition_counts.items():
        total = sum(targets.values())
        transition_matrix[from_step] = {
            to_step: round(count / total, 4) 
            for to_step, count in targets.most_common()
        }
    
    return transition_matrix


# ============================================================
# SECTION 6: SANKEY DATA GENERATION
# ============================================================

def generate_sankey_data(sessions: List[ProcessedSession], 
                          anomaly_scores: Dict) -> Dict:
    """
    Generate Sankey diagram data (nodes + links).
    Each unique step becomes a node. Each transition becomes a link.
    Link value = number of sessions making that transition.
    """
    # Count transitions
    transition_counts = defaultdict(int)
    step_set = set()
    
    for session in sessions:
        steps = session.events
        for step in steps:
            step_set.add(step)
        for i in range(len(steps) - 1):
            transition_counts[(steps[i], steps[i + 1])] += 1
    
    # Build nodes
    # Order nodes by typical funnel position
    STEP_ORDER = {
        '[start]': 0, 'homepage': 1, 'landing': 1, 'search': 2, 
        'category': 2, 'filter': 3, 'view': 3, 'pdp': 3, 
        'compare': 4, 'wishlist': 4, 'review': 4, 'size_guide': 4,
        'add_to_cart': 5, 'cart': 5, 'cart_edit': 6,
        'checkout': 7, 'payment': 8, 'purchase': 9, '[exit]': 10
    }
    
    sorted_steps = sorted(step_set, key=lambda s: STEP_ORDER.get(s, 5))
    node_index = {step: i for i, step in enumerate(sorted_steps)}
    
    nodes = [{"id": i, "name": step} for i, step in enumerate(sorted_steps)]
    
    # Build links with anomaly data
    links = []
    for (source, target), value in sorted(transition_counts.items(), 
                                           key=lambda x: -x[1]):
        if source not in node_index or target not in node_index:
            continue
        
        step_key = f"{source}_to_{target}"
        score_data = anomaly_scores.get(step_key, {})
        
        links.append({
            "source": node_index[source],
            "target": node_index[target],
            "value": value,
            "drop_off_rate": round(score_data.get('drop_off', 0), 4),
            "anomaly_score": round(score_data.get('z_score', 0), 2),
            "zone": score_data.get('zone', 'unknown'),
            "friction_level": score_data.get('friction_level', 'normal')
        })
    
    return {"nodes": nodes, "links": links}


# ============================================================
# SECTION 7: ANOMALY SCORING (Step-Type Aware)
# ============================================================

def compute_anomaly_scores(sessions: List[ProcessedSession]) -> Dict:
    """
    Step-type aware anomaly scoring.
    
    Each step's drop-off is scored against its funnel zone peers,
    not against global average. This prevents comparing homepage
    bounce (normal) with checkout abandonment (critical).
    """
    # Count transitions and exits per step
    step_stats = defaultdict(lambda: {'total': 0, 'exits': 0, 'transitions': defaultdict(int)})
    
    for session in sessions:
        steps = session.events
        for i, step in enumerate(steps):
            step_stats[step]['total'] += 1
            if i == len(steps) - 1 and step != 'purchase':
                step_stats[step]['exits'] += 1
            elif i < len(steps) - 1:
                step_stats[step]['transitions'][steps[i + 1]] += 1
    
    # Compute drop-off rates
    drop_off_rates = {}
    for step, stats in step_stats.items():
        if stats['total'] > 0:
            drop_off_rates[step] = stats['exits'] / stats['total']
    
    # Group by zone and compute zone-level statistics
    zone_rates = defaultdict(list)
    for step, rate in drop_off_rates.items():
        zone = get_zone(step)
        zone_rates[zone].append((step, rate))
    
    zone_stats = {}
    for zone, rates in zone_rates.items():
        values = [r[1] for r in rates]
        zone_stats[zone] = {
            'mean': np.mean(values) if values else 0,
            'std': max(np.std(values, ddof=1), min_std) if len(values) > 1 else min_std,  # minimum std to avoid division by zero
            'count': len(values)
        }
    
    # Score each transition
    anomaly_scores = {}
    for step, rate in drop_off_rates.items():
        zone = get_zone(step)
        stats = zone_stats[zone]
        
        # Z-score within zone
        z_score = (rate - stats['mean']) / max(stats['std'], 0.01)
        
        # Determine friction level
        if z_score > 2.0:
            friction_level = 'high'
        elif z_score > 1.5:
            friction_level = 'medium'
        else:
            friction_level = 'normal'
        
        # For each outgoing transition from this step
        for next_step, count in step_stats[step]['transitions'].items():
            key = f"{step}_to_{next_step}"
            total_from_step = step_stats[step]['total']
            transition_rate = count / total_from_step if total_from_step > 0 else 0
            
            anomaly_scores[key] = {
                'step': step,
                'next_step': next_step,
                'drop_off': rate,
                'transition_rate': round(transition_rate, 4),
                'zone': zone,
                'zone_baseline': round(stats['mean'], 4),
                'z_score': round(z_score, 2),
                'friction_level': friction_level,
                'sessions_at_step': step_stats[step]['total'],
                'sessions_exiting': step_stats[step]['exits'],
            }
        
        # Also add the exit transition
        exit_key = f"{step}_to_[exit]"
        anomaly_scores[exit_key] = {
            'step': step,
            'next_step': '[exit]',
            'drop_off': rate,
            'transition_rate': round(rate, 4),
            'zone': zone,
            'zone_baseline': round(stats['mean'], 4),
            'z_score': round(z_score, 2),
            'friction_level': friction_level,
            'sessions_at_step': step_stats[step]['total'],
            'sessions_exiting': step_stats[step]['exits'],
        }
    
    return anomaly_scores


# ============================================================
# SECTION 8: FRICTION PATTERN DETECTION
# ============================================================

def detect_friction_patterns(sessions: List[ProcessedSession]) -> List[Dict]:
    """
    Detect predefined behavioral friction patterns.
    These are heuristic pattern matches, NOT causal diagnoses.
    """
    patterns = {
        'search_frustration_loop': {
            'description': 'User searches 3+ times in a session — likely can\'t find what they want',
            'sessions': [],
            'detection': lambda events: events.count('search') >= 3
        },
        'cart_hesitation': {
            'description': 'User adds to cart but returns to viewing — price or size uncertainty',
            'sessions': [],
            'detection': lambda events: (
                'add_to_cart' in events and 
                any(events[i] == 'add_to_cart' and i + 1 < len(events) and events[i + 1] == 'view'
                    for i in range(len(events)))
            )
        },
        'bounce_back_browse': {
            'description': 'User goes category → product → category → product — browsing without conviction',
            'sessions': [],
            'detection': lambda events: (
                sum(1 for i in range(len(events) - 1) 
                    if events[i] == 'view' and events[i + 1] == 'category') >= 2
            )
        },
        'checkout_abandonment': {
            'description': 'User reaches checkout but does not purchase — payment or shipping friction',
            'sessions': [],
            'detection': lambda events: 'checkout' in events and 'purchase' not in events
        },
        'single_page_exit': {
            'description': 'User views only one page and leaves — content or relevance mismatch',
            'sessions': [],
            'detection': lambda events: len(events) == 1
        },
        'deep_browse_no_action': {
            'description': 'User views 5+ pages but never adds to cart — engaged but no intent signal',
            'sessions': [],
            'detection': lambda events: (
                len(events) >= 5 and 'add_to_cart' not in events
            )
        },
    }
    
    for session in sessions:
        for pattern_name, pattern in patterns.items():
            if pattern['detection'](session.events):
                pattern['sessions'].append(session.session_id)
    
    # Build output
    results = []
    total_sessions = len(sessions)
    
    for pattern_name, pattern in patterns.items():
        affected = pattern['sessions']
        if not affected:
            continue
        
        # Calculate conversion rate for sessions matching this pattern
        matching_sessions = [s for s in sessions if s.session_id in set(affected)]
        converting = sum(1 for s in matching_sessions if s.converted)
        
        results.append({
            'type': pattern_name,
            'description': pattern['description'],
            'sessions_affected': len(affected),
            'pct_of_total': round(len(affected) / total_sessions * 100, 1),
            'conversion_rate': round(converting / max(len(affected), 1), 4),
        })
    
    # Sort by sessions affected (highest impact first)
    results.sort(key=lambda x: -x['sessions_affected'])
    
    return results


# ============================================================
# SECTION 9: PATTERN MINING (Frequency-Based)
# ============================================================

def mine_journey_patterns(sessions: List[ProcessedSession], top_n: int = 20) -> Dict:
    """
    Mine the most frequent journey patterns.
    Separate converting vs non-converting.
    
    This is the frequency-based approach (works without Seq2Pat).
    Seq2Pat DPM can be layered on top for more sophisticated analysis.
    """
    # Count path frequencies
    converting_paths = Counter()
    non_converting_paths = Counter()
    
    for session in sessions:
        path_key = ' → '.join(session.events)
        if session.converted:
            converting_paths[path_key] += 1
        else:
            non_converting_paths[path_key] += 1
    
    total_converting = sum(1 for s in sessions if s.converted)
    total_non_converting = sum(1 for s in sessions if not s.converted)
    
    def format_patterns(counter, total, label):
        results = []
        for path_str, count in counter.most_common(top_n):
            steps = path_str.split(' → ')
            # Compute conversion rate for this exact path
            matching = [s for s in sessions if ' → '.join(s.events) == path_str]
            converts = sum(1 for s in matching if s.converted)
            
            results.append({
                'path': steps,
                'path_string': path_str,
                'count': count,
                'support': round(count / max(total, 1), 4),
                'conversion_rate': round(converts / max(len(matching), 1), 4),
                'avg_events': round(np.mean([s.n_events for s in matching]), 1),
            })
        return results
    
    converting = format_patterns(converting_paths, total_converting, 'converting')
    non_converting = format_patterns(non_converting_paths, total_non_converting, 'non_converting')
    
    # All patterns sorted by frequency
    all_paths = Counter()
    for session in sessions:
        path_key = ' → '.join(session.events)
        all_paths[path_key] += 1
    
    all_patterns = format_patterns(all_paths, len(sessions), 'all')
    
    # Find patterns unique to converting (appear in converting, rare in non-converting)
    converting_set = set(p['path_string'] for p in converting[:top_n])
    non_converting_set = set(p['path_string'] for p in non_converting[:top_n])
    
    unique_to_converting = [p for p in converting if p['path_string'] not in non_converting_set]
    unique_to_non_converting = [p for p in non_converting if p['path_string'] not in converting_set]
    
    return {
        'all': all_patterns[:top_n],
        'converting': converting[:top_n],
        'non_converting': non_converting[:top_n],
        'unique_to_converting': unique_to_converting[:10],
        'unique_to_non_converting': unique_to_non_converting[:10],
    }


# ============================================================
# SECTION 10: JSON EXPORT
# ============================================================

def export_showcase_json(sessions: List[ProcessedSession],
                          transition_matrices: Dict,
                          sankey_data: Dict,
                          anomaly_scores: Dict,
                          friction_patterns: List[Dict],
                          patterns: Dict,
                          output_path: str = 'showcase_data.json'):
    """Export everything as a single JSON for the React app."""
    
    total = len(sessions)
    converting = sum(1 for s in sessions if s.converted)
    avg_events = np.mean([s.n_events for s in sessions])
    avg_value = np.mean([s.total_value for s in sessions if s.total_value > 0])
    
    # Top friction points (for hero metrics)
    friction_ranked = sorted(
        [v for v in anomaly_scores.values() if v['next_step'] == '[exit]' and v['z_score'] > 1.5],
        key=lambda x: -x['z_score']
    )
    
    output = {
        'metadata': {
            'total_sessions': total,
            'converting_sessions': converting,
            'conversion_rate': round(converting / total, 4),
            'avg_events_per_session': round(avg_events, 1),
            'avg_session_value': round(avg_value, 2) if not np.isnan(avg_value) else 0,
            'data_source': 'synthetic_showcase',
            'generated_at': pd.Timestamp.now().isoformat(),
            'n_friction_points': len(friction_ranked),
            'top_friction_step': friction_ranked[0]['step'] if friction_ranked else None,
        },
        'sankey': sankey_data,
        'patterns': patterns,
        'friction': {
            'scores': [
                {
                    'step': v['step'],
                    'drop_off': v['drop_off'],
                    'zone': v['zone'],
                    'zone_baseline': v['zone_baseline'],
                    'z_score': v['z_score'],
                    'friction_level': v['friction_level'],
                    'sessions_at_step': v['sessions_at_step'],
                    'sessions_exiting': v['sessions_exiting'],
                }
                for v in sorted(
                    [v for v in anomaly_scores.values() if v['next_step'] == '[exit]'],
                    key=lambda x: -x['z_score']
                )
            ],
            'patterns_detected': friction_patterns,
        },
        'transition_matrix': {
            'all': transition_matrices['all'],
            'converting': transition_matrices['converting'],
            'non_converting': transition_matrices['non_converting'],
        },
    }
    
    with open(output_path, 'w') as f:
        json.dump(output, f, indent=2, default=str)
    
    print(f"\n✅ Exported to {output_path}")
    print(f"   File size: {len(json.dumps(output)) / 1024:.1f} KB")
    
    return output


# ============================================================
# SECTION 11: MAIN PIPELINE
# ============================================================

def run_pipeline(source: str = 'synthetic', 
                  input_path: str = None, 
                  n_sessions: int = 10000,
                  output_path: str = 'showcase_data.json'):
    """Run the complete analysis pipeline."""
    
    print("=" * 60)
    print("Journey Intelligence Engine — Analysis Pipeline")
    print("=" * 60)
    
    # Step 1: Load/generate data
    print("\n📊 Step 1: Loading data...")
    if source == 'rees46' and input_path:
        df = load_rees46(input_path, sample_sessions=n_sessions)
    else:
        df = generate_synthetic_data(n_sessions=n_sessions)
    
    # Step 2: Process sessions
    print("\n🔄 Step 2: Processing sessions...")
    sessions = process_sessions(df)
    print(f"   {len(sessions)} sessions processed")
    print(f"   Converting: {sum(1 for s in sessions if s.converted)}")
    print(f"   Avg events/session: {np.mean([s.n_events for s in sessions]):.1f}")
    
    # Step 3: Compute transition matrices
    print("\n📐 Step 3: Computing transition matrices...")
    transition_matrices = {
        'all': compute_transition_matrix(sessions),
        'converting': compute_transition_matrix(sessions, filter_converted=True),
        'non_converting': compute_transition_matrix(sessions, filter_converted=False),
    }
    n_steps = len(transition_matrices['all'])
    print(f"   {n_steps} unique steps in transition matrix")
    
    # Step 4: Anomaly scoring
    print("\n🔍 Step 4: Computing anomaly scores (step-type aware)...")
    anomaly_scores = compute_anomaly_scores(sessions)
    high_friction = sum(1 for v in anomaly_scores.values() 
                        if v.get('friction_level') == 'high' and v['next_step'] == '[exit]')
    print(f"   {high_friction} high-friction exit points detected")
    
    # Step 5: Friction patterns
    print("\n⚠️  Step 5: Detecting friction patterns...")
    friction_patterns = detect_friction_patterns(sessions)
    for p in friction_patterns[:5]:
        print(f"   • {p['type']}: {p['sessions_affected']} sessions ({p['pct_of_total']}%), CR: {p['conversion_rate']:.1%}")
    
    # Step 6: Pattern mining
    print("\n🧬 Step 6: Mining journey patterns...")
    patterns = mine_journey_patterns(sessions)
    print(f"   Top converting path: {patterns['converting'][0]['path_string'] if patterns['converting'] else 'N/A'}")
    print(f"   Top non-converting: {patterns['non_converting'][0]['path_string'] if patterns['non_converting'] else 'N/A'}")
    
    # Step 7: Generate Sankey data
    print("\n📊 Step 7: Generating Sankey data...")
    sankey_data = generate_sankey_data(sessions, anomaly_scores)
    print(f"   {len(sankey_data['nodes'])} nodes, {len(sankey_data['links'])} links")
    
    # Step 8: Export
    print("\n💾 Step 8: Exporting JSON...")
    output = export_showcase_json(
        sessions=sessions,
        transition_matrices=transition_matrices,
        sankey_data=sankey_data,
        anomaly_scores=anomaly_scores,
        friction_patterns=friction_patterns,
        patterns=patterns,
        output_path=output_path,
    )
    
    print("\n" + "=" * 60)
    print("✅ Pipeline complete!")
    print("=" * 60)
    
    return output


# ============================================================
# CLI
# ============================================================

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Journey Intelligence Engine — Analysis Pipeline')
    parser.add_argument('--source', choices=['rees46', 'synthetic'], default='synthetic',
                        help='Data source: rees46 (requires --input) or synthetic')
    parser.add_argument('--input', type=str, default=None,
                        help='Path to REES46 CSV file (e.g., 2019-Oct.csv)')
    parser.add_argument('--sessions', type=int, default=10000,
                        help='Number of sessions to process/generate')
    parser.add_argument('--output', type=str, default='showcase_data.json',
                        help='Output JSON file path')
    
    args = parser.parse_args()
    run_pipeline(
        source=args.source,
        input_path=args.input,
        n_sessions=args.sessions,
        output_path=args.output,
    )
