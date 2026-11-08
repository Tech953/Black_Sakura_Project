"""Portable data bridge. Imports load no neural runtime or network code."""
from .contracts import ContractError, speech_body
from .pack import ReferencePack
from .render import inspect_render
from .action import action_plan
__version__ = "1.0.0"
__all__ = ["ContractError", "ReferencePack", "speech_body", "inspect_render", "action_plan"]
