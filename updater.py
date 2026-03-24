import os, sys, requests, zipfile, shutil, subprocess

CURRENT_VERSION = "v0.0.3"
GITHUB_REPO = "StraReal/MarketViz" # Change to manage your own updates

def check_for_update():
    try:
        r = requests.get(
            f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest",
            headers={"User-Agent": "auto-updater"},
            timeout=10
        )
        if r.status_code != 200:
            print(f"Could not fetch latest release from GitHub, failed with status code {r.status_code}")
            return

        latest = r.json().get("tag_name")
        if not latest or latest == CURRENT_VERSION:
            print("Already up to date")
            return

        print(f"[updater] New version {latest}, updating...")
        zip_url = f"https://github.com/{GITHUB_REPO}/archive/refs/tags/{latest}.zip"
        download_and_apply(zip_url, latest)

    except Exception as e:
        print(f"[updater] Update check failed: {e}")


def download_and_apply(zip_url, new_version):
    r = requests.get(zip_url, stream=True, timeout=30)
    with open("update.zip", "wb") as f:
        shutil.copyfileobj(r.raw, f)

    with zipfile.ZipFile("update.zip") as z:
        z.extractall("update_tmp/")

    extracted_dir = f"update_tmp/MarketViz-{new_version.lstrip('v')}/"

    SKIP = {"secrets.json", "history", "portfolios", "dates", ".env"}

    for item in os.listdir(extracted_dir):
        if item in SKIP:
            continue
        src = os.path.join(extracted_dir, item)
        dst = item
        if os.path.isfile(src):
            shutil.copy2(src, dst)
        elif os.path.isdir(src):
            shutil.copytree(src, dst, dirs_exist_ok=True)

    shutil.rmtree("update_tmp", ignore_errors=True)
    os.remove("update.zip")
    print("[updater] Update applied, restarting...")
    subprocess.Popen([sys.executable] + sys.argv)
    sys.exit(0)