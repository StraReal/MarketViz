@echo off

IF NOT EXIST .venv (
    echo [mviz] Creating virtual environment...
    python -m venv .venv
)

call .venv\Scripts\activate
pip install -r requirements.txt -q
python app.py