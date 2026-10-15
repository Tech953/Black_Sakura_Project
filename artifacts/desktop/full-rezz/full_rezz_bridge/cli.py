from __future__ import annotations
import argparse, json, sys
from . import ReferencePack, action_plan, inspect_render
from .contracts import ContractError, read_json

def main(argv=None):
    parser = argparse.ArgumentParser(description="FULL_REZZ portable engram bridge; JSON output, no hosted service.")
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("inspect-pack"); p.add_argument("folder"); p.add_argument("--profile")
    p = commands.add_parser("request"); p.add_argument("folder"); p.add_argument("profile"); p.add_argument("text"); p.add_argument("--style", default="neutral")
    p = commands.add_parser("inspect-render"); p.add_argument("folder"); p.add_argument("--profile")
    p = commands.add_parser("action-plan"); p.add_argument("root"); p.add_argument("descriptor"); p.add_argument("--profile")
    p = commands.add_parser("local-render"); p.add_argument("--app-root", required=True); p.add_argument("--project-root", required=True); p.add_argument("--request", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "inspect-pack":
            pack = ReferencePack(args.folder); result = pack.to_engram(args.profile or pack.profile_ids[0])
        elif args.command == "request": result = ReferencePack(args.folder).request(args.profile, args.text, style=args.style)
        elif args.command == "inspect-render": result = inspect_render(args.folder, args.profile)
        elif args.command == "action-plan": result = action_plan(args.root, read_json(args.descriptor), args.profile)
        else:
            from .local import LocalRuntime
            request = read_json(args.request)
            if not isinstance(request, dict) or request.get("kind") != "full_rezz_render_request": raise ContractError("Supply a bridge render-request JSON file.")
            with LocalRuntime(args.app_root, args.project_root) as runtime: result = runtime.render(request.get("body"))
        print(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2)); return 0
    except (ContractError, OSError, RuntimeError) as exc:
        print(json.dumps({"error": str(exc), "kind": "full_rezz_bridge_error"}), file=sys.stderr); return 2

if __name__ == "__main__": raise SystemExit(main())
