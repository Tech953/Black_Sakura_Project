"""Current native validation entrypoint; prior six-tab checks are historical."""
from pathlib import Path
import subprocess,sys
root=Path(__file__).resolve().parent
for name in ['validate_locales.py','validate_native_v3.py']:
 subprocess.run([sys.executable,str(root/name)],check=True)
