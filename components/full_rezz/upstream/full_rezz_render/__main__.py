import argparse, json, sys

def main():
    parser=argparse.ArgumentParser(description="Offline FULL_REZZ authored-cel rendering and audits")
    commands=parser.add_subparsers(dest="command",required=True)
    render=commands.add_parser("render");render.add_argument("project");render.add_argument("output");render.add_argument("--preset",choices=["preview","production","ultra"],default="production");render.add_argument("--fps",type=int,default=60)
    render.add_argument("--no-full-raster-reference",action="store_true",help="Omit the raw pixel reference; only portable subset auditing will be available")
    process=commands.add_parser("process");process.add_argument("project");process.add_argument("output");process.add_argument("--preset",choices=["preview","production","ultra"],default="production");process.add_argument("--fps",type=int,default=60);process.add_argument("--ffmpeg");process.add_argument("--ffprobe")
    audit=commands.add_parser("audit");audit.add_argument("project");audit.add_argument("output");audit.add_argument("--ffmpeg");audit.add_argument("--ffprobe")
    audit.add_argument("--raw-reference",help="Explicit lossless RGB reference path, including a private temporary buffer")
    layout=commands.add_parser("layout",help="Review geometry guides against an existing render")
    layout.add_argument("project");layout.add_argument("render_directory");layout.add_argument("destination");layout.add_argument("--movie",help="Explicit movie path when media and evidence are stored separately")
    args=parser.parse_args()
    try:
        if args.command=="render":
            from .render import render
            result=render(args.project,args.output,args.preset,args.fps,lambda n,total:print(f"Rendered {n}/{total}",file=sys.stderr,flush=True),not args.no_full_raster_reference)
        elif args.command=="process":
            from .pipeline import process
            result=process(args.project,args.output,args.preset,args.fps,lambda n,total:print(f"Rendered {n}/{total}",file=sys.stderr,flush=True),args.ffmpeg,args.ffprobe)
        elif args.command=="layout":
            from .layout import analyze
            result=analyze(args.project,args.render_directory,args.destination,args.movie)
        else:
            from .audit import audit
            result=audit(args.project,args.output,args.ffmpeg,args.ffprobe,args.raw_reference)
        print(json.dumps(result,indent=2));return 0 if result.get("failed",0)==0 else 2
    except Exception as error:
        print(json.dumps({"error":str(error),"kind":type(error).__name__}),file=sys.stderr);return 2

if __name__=="__main__":sys.exit(main())
