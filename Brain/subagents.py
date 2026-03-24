from Database.prompts import internet_explorer_prompt
from Tools import internet_search, crawl_image, batch_crawl_images, bulk_crawl_images


class SubAgents:
    def __init__(self):
        pass

    def _get_subagents(self):
        self.subagents = [
            {
                "name": "Internet Explorer",
                "description": (
                    "Internet Explorer is a precision research intelligence agent specialized in deep web research, "
                    "data gathering, and visual content retrieval. Delegate all research-related tasks, "
                    "fact-finding missions, topic exploration, and image searches to Internet Explorer."
                ),
                "system_prompt": internet_explorer_prompt,
                "tools": [
                    internet_search,
                    crawl_image,
                    batch_crawl_images,
                    bulk_crawl_images,
                ],
                "model": "google_genai:gemini-3.1-flash-lite-preview",
            }
        ]
        return self.subagents

    def get_subagents(self):
        return self._get_subagents()
