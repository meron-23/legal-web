import requests
from bs4 import BeautifulSoup
import json
import time
import random
import os
import re
import firebase_admin
from firebase_admin import credentials, firestore

# --- CONFIGURATION ---
BASE_URL = 'https://www.fsc.gov.et/Digital-Law-Library/Judgments/' 
OUTPUT_FILE = 'cases.json'
SERVICE_ACCOUNT_PATH = 'service-account.json'

# Initialize Firestore
db = None
if os.path.exists(SERVICE_ACCOUNT_PATH):
    try:
        cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
        firebase_admin.initialize_app(cred)
        db = firestore.client()
        print("Firestore initialized successfully.")
    except Exception as e:
        print(f"Error initializing Firestore: {e}")
else:
    print(f"Warning: {SERVICE_ACCOUNT_PATH} not found. Running in local-only mode.")

def save_to_json(data):
    """Saves a single case or list of cases to the local JSON file."""
    existing_data = []
    if os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
        except json.JSONDecodeError:
            pass
            
    existing_data.append(data)
    
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(existing_data, f, indent=4, ensure_ascii=False)

def save_to_firestore(data):
    """Uploads case data to Firestore 'cases' collection."""
    if db is None:
        return
    
    try:
        # Use caseFileNo as document ID to prevent duplicates
        doc_id = data['caseFileNo'].replace('/', '_') # Firestore IDs shouldn't have '/'
        
        # Prepare data for Firestore (handle timestamps if needed)
        firestore_data = data.copy()
        
        # We can add a server timestamp for sorting
        firestore_data['createdAt'] = firestore.SERVER_TIMESTAMP
        
        db.collection('cases').document(doc_id).set(firestore_data)
        print(f"Uploaded to Firestore: {doc_id}")
    except Exception as e:
        print(f"Error uploading to Firestore: {e}")

def parse_case_info(case_title, summary, link=""):
    """Core logic to parseCase info from strings with robust fallback."""
    # 1. Parse Parties (Plaintiff እና Defendant)
    # Using regex to split on common Amharic markers for parties
    parties_part = re.split(r'የ[ሰመ]/ቁ|መ\.ቁ|ቁጥር', case_title)[0].strip()
    
    # Split on 'እና' or 'እነ' to identify parties, being very careful with spacing
    party_split = re.split(r'\s+(?:እና|እነ)\s+', parties_part)
    if len(party_split) >= 2:
        plaintiff = party_split[0].strip()
        defendant = party_split[1].strip()
    else:
        plaintiff = parties_part
        defendant = "N/A"

    # 2. Case Number
    case_no_match = re.search(r'(\d+/\d+/\d+)', case_title) or re.search(r'(\d+/\d+/\d+)', summary)
    if not case_no_match:
        simple_no = re.search(r'(\d{5,})', case_title) or re.search(r'(\d{5,})', summary)
        case_file_no = simple_no.group(1) if simple_no else "FSC-NEW"
    else:
        case_file_no = case_no_match.group(1)

    # 3. Bench & Court Info
    bench_match = re.search(r'([^\s]+)\s+ሰበር\s+ችሎት', summary) or re.search(r'([^\s]+)\s+ሰበር\s+ችሎት', case_title)
    bench = f"{bench_match.group(1)} ሰበር ችሎት" if bench_match else "Federal Supreme Court"

    # 4. Date Resolved
    date_resolved = "N/A"
    date_num_match = re.search(r'(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})', summary)
    if date_num_match:
        date_resolved = date_num_match.group(0)
    else:
        date_am_match = re.search(r'([ሀ-ፐ]+)\s+(\d{1,2})\s+ቀን\s+(\d{4})', summary)
        if date_am_match:
            date_resolved = f"{date_am_match.group(1)} {date_am_match.group(2)}, {date_am_match.group(3)}"

    # 5. Decision & Who Won
    who_won = "Unknown"
    decision_compared = "Judgment Available"
    
    # Combined search for decision markers
    full_text = f"{case_title} {summary}"
    if any(key in full_text for key in ["ተሽሮ", "ተሻሽሎ", "ተሽሮ የተመለሰ", "ተሰረዘ"]):
        decision_compared = "Reversed/Modified (ተሽሮ/ተሻሽሎ)"
        if "ከሳሽ" in full_text: who_won = "Plaintiff (ከሳሽ)"
        elif "አመልካች" in full_text: who_won = "Appellant (አመልካች)"
        else: who_won = "Appellant/Plaintiff"
    elif any(key in full_text for key in ["ጸንቷል", "አልተቀበለውም", "ተቃውሞ"]):
        decision_compared = "Upheld (ጸንቷል)"
        if "ተጠሪ" in full_text: who_won = "Respondent (ተጠሪ)"
        elif "ተከሳሽ" in full_text: who_won = "Defendant (ተከሳሽ)"
        else: who_won = "Respondent/Defendant"
    elif "ጥፋተኛ" in full_text:
        decision_compared = "Guilty (ጥፋተኛ)"
        who_won = "Prosecution/State"

    return {
        'caseFileNo': case_file_no,
        'plaintiff': plaintiff,
        'defendant': defendant,
        'bench': bench,
        'whoWon': who_won,
        'decisionCompared': decision_compared,
        'dateResolved': date_resolved,
        'summary': summary[:250] + "..." if len(summary) > 250 else summary,
        'link': link if not link or link.startswith('http') else "https://www.fsc.gov.et" + link,
        'scrapedAt': time.strftime('%Y-%m-%d %H:%M:%S')
    }

def scrape_cases():
    cases_saved = 0
    # Initialize file
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump([], f)

    print(f"Scraping {BASE_URL}...")
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
    
    try:
        response = requests.get(BASE_URL, headers=headers, timeout=15)
        if response.status_code != 200:
            print(f"Failed to fetch FSC page. Status: {response.status_code}")
            return
            
        soup = BeautifulSoup(response.text, 'html.parser')

        # Collect all potential case entries (headers and tables)
        case_entries = []

        # --- MODE 1: SCAN TABLES ---
        tables = soup.find_all('table')
        for table in tables:
            rows = table.find_all('tr')
            for row in rows:
                cols = row.find_all(['td', 'th'])
                if len(cols) >= 3:
                    title_tag = cols[0]
                    title_text = title_tag.text.strip()
                    if any(h in title_text for h in ["Case", "Plaintiff", "መለያ", "ተከሳሽ"]): continue
                    
                    link_tag = title_tag.find('a')
                    link = link_tag['href'] if link_tag else ""
                    desc = " ".join([c.text.strip() for c in cols[1:]])
                    case_entries.append({'title': title_text, 'summary': desc, 'link': link})

        # --- MODE 2: SCAN HEADERS ---
        case_items = soup.find_all(['h2', 'h3'])
        for item in case_items:
            link_tag = item.find('a')
            if not link_tag: continue
            
            case_title = link_tag.text.strip()
            summary_tag = item.find_next_sibling(['p', 'div'])
            summary = summary_tag.text.strip() if summary_tag else ""
            case_entries.append({'title': case_title, 'summary': summary, 'link': link_tag['href']})

        # --- DEEP SCRAPING & SYNC ---
        print(f"Total entries found: {len(case_entries)}. Starting deep scrape...")
        
        for entry in case_entries:
            full_summary = entry['summary']
            case_url = entry['link']
            
            if case_url:
                try:
                    # Resolve full URL
                    detail_url = case_url if case_url.startswith('http') else "https://www.fsc.gov.et" + case_url
                    print(f"Fetching detail: {detail_url}")
                    
                    detail_res = requests.get(detail_url, headers=headers, timeout=10)
                    if detail_res.status_code == 200:
                        detail_soup = BeautifulSoup(detail_res.text, 'html.parser')
                        # Extract main article content (EasyDNNNews common selectors)
                        article_body = detail_soup.select_one('.edn_articleContent, .edn_articleSummary, .edn_fullArticle')
                        if article_body:
                            full_summary = article_body.text.strip()
                        else:
                            # Fallback: get all main content area text
                            main_content = detail_soup.find('main') or detail_soup.find('article') or detail_soup.find(id='content')
                            if main_content:
                                # Clean up extra whitespace/tabs
                                full_summary = " ".join(main_content.text.split())
                except Exception as e:
                    print(f"Error fetching detail for {entry['title']}: {e}")
                
                # Small delay to be polite
                time.sleep(random.uniform(1.5, 3))

            # Parse with the richest text available
            case_data = parse_case_info(entry['title'], full_summary, entry['link'])
            
            # Save locally
            save_to_json(case_data)
            
            # Sync to Firestore
            save_to_firestore(case_data)
            
            cases_saved += 1
            print(f"Saved: {case_data['caseFileNo']}")

    except Exception as e:
        print(f"Error processing FSC page: {e}")

    print(f"Scraping complete. Total cases saved: {cases_saved}")

if __name__ == "__main__":
    scrape_cases()
