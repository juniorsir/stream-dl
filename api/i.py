# api/index.py - The Definitive, Feature-Complete Python Backend

import os
import json
import subprocess
from functools import wraps
import requests
from flask import Flask, request, jsonify, send_file
import yt_dlp
import psycopg2
from psycopg2.pool import SimpleConnectionPool

app = Flask(__name__)

# --- Configuration ---
project_root = os.path.dirname(os.path.abspath(os.path.dirname(__file__)))
ffmpeg_path = os.path.join(project_root, 'bin', 'ffmpeg')
cookies_path = os.path.join(project_root, 'cookies.txt')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD')
DATABASE_URL = os.environ.get('DATABASE_URL')

# --- Database Connection Pool ---
db_pool = None
if DATABASE_URL:
    try:
        db_pool = SimpleConnectionPool(1, 10, dsn=DATABASE_URL)
        print("Database connection pool created successfully.")
    except Exception as e:
        print(f"FATAL: Failed to create database connection pool: {e}")
else:
    print("WARNING: DATABASE_URL not set. Admin dashboard will have limited functionality.")

def initialize_database():
    if not db_pool: return
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            cur.execute("""CREATE TABLE IF NOT EXISTS request_logs (id SERIAL PRIMARY KEY, url TEXT NOT NULL, timestamp TIMESTAMPTZ DEFAULT NOW());""")
            cur.execute("""CREATE TABLE IF NOT EXISTS blocked_domains (id SERIAL PRIMARY KEY, domain TEXT NOT NULL UNIQUE, timestamp TIMESTAMPTZ DEFAULT NOW());""")
            cur.execute("""CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value BOOLEAN NOT NULL);""")
            cur.execute("""INSERT INTO settings (key, value) VALUES ('is_redirect_mode_enabled', false) ON CONFLICT (key) DO NOTHING;""")
            conn.commit()
            print("Database tables are ready.")
    except Exception as e:
        print(f"Error initializing database: {e}")
    finally:
        if conn:
            db_pool.putconn(conn)

# Initialize the database on startup
initialize_database()

# --- In-Memory State (loaded from DB) ---
is_redirect_mode = False
blocked_domains = set()

def load_settings():
    global is_redirect_mode
    if not db_pool: return
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            cur.execute("SELECT value FROM settings WHERE key = 'is_redirect_mode_enabled'")
            row = cur.fetchone()
            if row:
                is_redirect_mode = row[0]
                print(f"Settings loaded: Redirect Mode is {'ENABLED' if is_redirect_mode else 'DISABLED'}.")
    except Exception as e:
        print(f"Could not load settings: {e}")
    finally:
        if conn: db_pool.putconn(conn)

def load_blocked_domains():
    global blocked_domains
    if not db_pool: return
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            cur.execute("SELECT domain FROM blocked_domains")
            rows = cur.fetchall()
            blocked_domains = {row[0] for row in rows}
            print(f"Loaded {len(blocked_domains)} blocked domains.")
    except Exception as e:
        print(f"Could not load blocked domains: {e}")
    finally:
        if conn: db_pool.putconn(conn)

load_settings()
load_blocked_domains()

def log_request(url):
    if not db_pool or not url: return
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            cur.execute("INSERT INTO request_logs (url) VALUES (%s)", (url,))
            conn.commit()
    except Exception as e:
        print(f"DB Log Error: {e}")
    finally:
        if conn: db_pool.putconn(conn)

# --- Security Decorator ---
def verify_admin(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not ADMIN_PASSWORD: return jsonify({"error": "Admin not configured."}), 500
        if not auth_header or not auth_header.startswith('Bearer ') or auth_header.split(' ')[1] != ADMIN_PASSWORD:
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return decorated_function

# --- Serve Static Frontend ---
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_static(path):
    public_dir = os.path.join(project_root, "public")
    if path != "" and os.path.exists(os.path.join(public_dir, path)):
        return send_file(os.path.join(public_dir, path))
    else:
        return send_file(os.path.join(public_dir, 'index.html'))

# --- PUBLIC API Endpoints ---
@app.route('/api/get-data', methods=['POST'])
def get_data():
    url = request.json.get('url')
    if not url: return jsonify({"error": "URL is required."}), 400
    if any(domain in url for domain in blocked_domains):
        return jsonify({"error": "Access to this website is blocked by the administrator."}), 403
    
    log_request(url)
    
    try:
        ydl_opts = {'quiet': True, 'no_warnings': True, 'skip_download': True}
        if os.path.exists(cookies_path): ydl_opts['cookiefile'] = cookies_path
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            duration = info.get("duration") or 0
            formats = []
            for f in info.get('formats', []):
                filesize = f.get("filesize") or f.get("filesize_approx")
                if not filesize and f.get("tbr") and duration:
                    filesize = int((f["tbr"] * 1000 / 8) * duration)
                filesize_mib_str = "N/A"
                if filesize: filesize_mib_str = f"{round(filesize / (1024 * 1024), 2)} MiB"
                
                formats.append({
                    'id': f.get('format_id'), 'ext': f.get('ext'),
                    'resolution': f.get('resolution') or (f"{f.get('height')}p" if f.get('height') else "audio only"),
                    'filesize': filesize_mib_str, 'note': f.get('format_note', ''),
                    'vcodec': f.get('vcodec', 'none'), 'acodec': f.get('acodec', 'none')
                })
        
        return jsonify({'title': info.get('title'),'thumbnail': info.get('thumbnail'), 'formats': formats})
    except Exception as e:
        error_message = str(e)
        if 'Unsupported URL' in error_message: error_message = 'This website or URL is not supported.'
        elif 'Video unavailable' in error_message: error_message = 'This video is unavailable.'
        elif 'Sign in to confirm' in error_message: error_message = 'This video is private or age-restricted. A valid cookie file may be required.'
        return jsonify({"error": f"Failed to fetch data: {error_message}"}), 500

@app.route('/api/download')
def download_stream():
    url = request.args.get('url')
    format_id = request.args.get('format_id')
    title = request.args.get('title', 'video')
    
    if not url or not format_id: return "URL and format_id are required", 400

    clean_title = "".join([c for c in title if c.isalpha() or c.isdigit() or c in ' ._-']).rstrip()
    
    ydl_opts = {'format': format_id, 'cookiefile': cookies_path if os.path.exists(cookies_path) else None, 'ffmpeg_location': ffmpeg_path, 'outtmpl': '-'}
    
    try:
        command = [
            'yt-dlp', '-f', format_id,
            '--cookies', cookies_path if os.path.exists(cookies_path) else '""',
            '-o', '-', url
        ]
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return process.stdout, {"Content-Disposition": f"attachment; filename=\"{clean_title}.mp4\""}
    except Exception as e:
        return f"Download failed: {str(e)}", 500

@app.route('/api/image-proxy')
def image_proxy():
    url = request.args.get('url')
    if not url: return "URL is required", 400
    try:
        response = requests.get(url, stream=True, headers={'Referer': url})
        response.raise_for_status()
        return response.content, response.status_code, response.headers.items()
    except requests.exceptions.RequestException as e:
        return f"Image not found: {str(e)}", 404
        
# --- ADMIN API Endpoints ---
@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    password = request.json.get('password')
    if not ADMIN_PASSWORD: return jsonify({"error": "Admin not configured."}), 500
    if password == ADMIN_PASSWORD: return jsonify({"success": True})
    else: return jsonify({"success": False, "error": "Invalid password"}), 401

@app.route('/api/admin/stats')
@verify_admin
def admin_stats(): return jsonify({"cacheSize": 0})

@app.route('/api/admin/requests')
@verify_admin
def admin_requests():
    if not db_pool: return jsonify([]), 500
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            cur.execute("SELECT url, timestamp FROM request_logs ORDER BY timestamp DESC LIMIT 50")
            rows = cur.fetchall()
            logs = [{"url": row[0], "timestamp": row[1].isoformat()} for row in rows]
            return jsonify(logs)
    except Exception as e: return jsonify({"error": f"Failed to fetch logs: {e}"}), 500
    finally:
        if conn: db_pool.putconn(conn)

@app.route('/api/admin/blocked-domains', methods=['GET'])
@verify_admin
def get_blocked_domains(): return jsonify(list(blocked_domains))

@app.route('/api/admin/blocked-domains', methods=['POST'])
@verify_admin
def add_blocked_domain():
    domain = request.json.get('domain')
    if not domain or not db_pool: return jsonify({"error": "Invalid request"}), 400
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            cur.execute("INSERT INTO blocked_domains (domain) VALUES (%s) ON CONFLICT (domain) DO NOTHING", (domain.strip(),))
            conn.commit()
        load_blocked_domains()
        return jsonify({"success": True}), 201
    except Exception as e: return jsonify({"error": f"Failed to add domain: {e}"}), 500
    finally:
        if conn: db_pool.putconn(conn)
        
@app.route('/api/admin/blocked-domains', methods=['DELETE'])
@verify_admin
def delete_blocked_domain():
    domain = request.json.get('domain')
    if not domain or not db_pool: return jsonify({"error": "Invalid request"}), 400
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            cur.execute("DELETE FROM blocked_domains WHERE domain = %s", (domain.strip(),))
            conn.commit()
        load_blocked_domains()
        return jsonify({"success": True})
    except Exception as e: return jsonify({"error": f"Failed to delete domain: {e}"}), 500
    finally:
        if conn: db_pool.putconn(conn)

@app.route('/api/admin/settings', methods=['GET'])
@verify_admin
def get_admin_settings(): return jsonify({"is_redirect_mode_enabled": is_redirect_mode})

@app.route('/api/admin/settings', methods=['POST'])
@verify_admin
def update_admin_settings():
    global is_redirect_mode
    is_enabled = request.json.get('is_redirect_mode_enabled')
    if not isinstance(is_enabled, bool) or not db_pool: return jsonify({"error": "Invalid request"}), 400
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            cur.execute("UPDATE settings SET value = %s WHERE key = 'is_redirect_mode_enabled'", (is_enabled,))
            conn.commit()
        load_settings()
        return jsonify({"success": True})
    except Exception as e: return jsonify({"error": f"Failed to update settings: {e}"}), 500
    finally:
        if conn: db_pool.putconn(conn)
