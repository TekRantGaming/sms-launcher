"""Pack relocation data while retaining normalized symlinks from the installed tree."""
import os
import sys
import conda_pack

prefix, output = sys.argv[1:]
environment = conda_pack.CondaEnv.from_prefix(prefix)
for record in environment.files:
    installed = os.path.join(prefix, record.target)
    # conda-pack normally copies managed symlinks from its original package cache.
    # Use our flattened links so extraction never has to follow a symlink chain.
    if os.path.islink(installed):
        record.source = installed
environment.pack(output=output, arcroot="env", force=True)
