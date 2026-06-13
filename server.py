import http.server
import socketserver
import urllib.request
import urllib.error
import os
import time
import json
import re

PORT = 8000
CACHE_DIR = ".cache"
CACHE_EXPIRY = 3600  # 1 hour in seconds

# Ensure cache directory exists
if not os.path.exists(CACHE_DIR):
    os.makedirs(CACHE_DIR)

# Supported CelesTrak groups mapped to their API names
VALID_GROUPS = {
    "stations": "stations",
    "visual": "visual",
    "starlink": "starlink",
    "gps": "gps-ops",
    "weather": "weather",
    "science": "science",
    "geo": "geo",
    "active": "active"
}

def fetch_and_cache_tle(group):
    """Fetches TLE from Celestrak or returns cached version if fresh."""
    api_group = VALID_GROUPS.get(group, "stations")
    cache_path = os.path.join(CACHE_DIR, f"{api_group}.txt")
    
    # Check if cache exists and is fresh
    if os.path.exists(cache_path):
        mtime = os.path.getmtime(cache_path)
        if time.time() - mtime < CACHE_EXPIRY:
            print(f"Loading {api_group} from cache...")
            with open(cache_path, "r", encoding="utf-8") as f:
                return f.read()
                
    # Fetch from Celestrak
    url = f"https://celestrak.org/NORAD/elements/gp.php?GROUP={api_group}&FORMAT=3LE"
    print(f"Fetching from Celestrak: {url}")
    try:
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            data = response.read().decode('utf-8')
            # Write to cache
            with open(cache_path, "w", encoding="utf-8") as f:
                f.write(data)
            return data
    except urllib.error.URLError as e:
        print(f"Error fetching from CelesTrak: {e}")
        # If fetch fails, try to return stale cache as fallback
        if os.path.exists(cache_path):
            print("Fetch failed. Using stale cache as fallback...")
            with open(cache_path, "r", encoding="utf-8") as f:
                return f.read()
        raise e

def parse_3le(raw_data):
    """Parses 3LE plaintext data into a structured list of dictionaries."""
    satellites = []
    lines = [line.strip() for line in raw_data.split('\n') if line.strip()]
    
    i = 0
    while i < len(lines) - 2:
        l0 = lines[i]
        l1 = lines[i+1]
        l2 = lines[i+2]
        
        # Check if line 1 starts with '1 ' and line 2 starts with '2 '
        # which is the signature of a TLE pair.
        if l1.startswith('1 ') and l2.startswith('2 '):
            norad_id = l1[2:7].strip()
            name = l0
            
            satellites.append({
                "name": name,
                "line1": l1,
                "line2": l2,
                "noradId": norad_id
            })
            i += 3
        else:
            i += 1
            
    return satellites

class SatelliteProxyHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # API Endpoint to fetch and parse satellite TLE data
        if self.path.startswith('/api/tle'):
            # Parse query parameters
            group = "stations"  # default
            match = re.search(r'group=([^&]+)', self.path)
            if match:
                group = match.group(1).lower()
                
            if group not in VALID_GROUPS:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"error": f"Invalid group. Must be one of: {list(VALID_GROUPS.keys())}"}).encode())
                return
                
            try:
                raw_data = fetch_and_cache_tle(group)
                sat_list = parse_3le(raw_data)
                
                # Send JSON response
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(sat_list).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"error": f"Failed to retrieve data: {str(e)}"}).encode())
            return
            
        # Expose active server response for health checks
        elif self.path == '/api/status':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "running"}).encode())
            return
            
        # Default simple HTTP server behavior to serve static files
        super().do_GET()

# Set the serving directory to the folder where server.py lives
os.chdir(os.path.dirname(os.path.abspath(__file__)))

with socketserver.TCPServer(("", PORT), SatelliteProxyHandler) as httpd:
    print(f"Satellite Tracker server running at http://localhost:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
