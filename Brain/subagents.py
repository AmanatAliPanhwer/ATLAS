from Database.prompts import research_instructions
from Tools import internet_search

class SubAgents:
    def __init__(self):
        pass
    
    def _get_subagents(self):
        self.subagents = [
            {
                "name": "researcher",
                "description": "Expert researcher for deep research tasks. Use for all research-related queries.",
                "system_prompt": research_instructions,
                "tools": [internet_search],
                "model": "google_genai:gemini-3.1-flash-lite-preview",
            }
        ]
        return self.subagents

    def get_subagents(self):
        return self._get_subagents()
