from ddgs import DDGS
import requests
import os
from langchain.tools import tool
import asyncio

def _get_image_links(
    keyword: str, max_images: int = 1, retries: int = 30
) -> list | None:
    print(f"[Image Crawler] Searching for '{keyword}' images...")
    links = []
    attempt = 0

    while attempt < retries:
        try:
            with DDGS() as ddgs:
                results = ddgs.images(keyword, max_results=max_images)

                for result in results:
                    image_url = result.get("image")
                    if image_url:
                        links.append(image_url)

                return links
        except Exception as e:
            attempt += 1
    return ["Failed to retrieve image links after multiple attempts."]


@tool
def crawl_image(keyword: str) -> str | None:
    """
    Fetches the first image URL for a given keyword and sends it to the display API.

    Args:
        keyword (str): The search term used to find and label the image.

    Returns:
        str | None: A success message if the image was sent, an error message if
        the request failed, or a message indicating no image link was found.
    """

    image_link: str = str(_get_image_links(keyword)[0])

    if image_link:
        try:
            params = {
                "params": {
                    "url": image_link,
                    "name": keyword,
                }
            }

            requests.post(
                f"{os.environ.get('API_URL')}/show-image",
                json=params,
            )
            return "Image URL displayed successfully."
        except Exception as e:
            return f"An error occurred while crawling image URL: {e}"
    else:
        return "No image link found to display."


@tool
def batch_crawl_images(keywords: list[str]) -> list[str] | str | None:
    """
    Fetches image URLs for a list of keywords and sends them all to the display API in a single batch request.

    Args:
        keywords (list[str]): A list of search terms to find and label images for.

    Returns:
        list[str] | str | None: A success message with the results list if all images
        were sent, an error message if any keyword yields no image or the request fails.
    """
    results = []
    for keyword in keywords:
        image_link: str = str(_get_image_links(keyword)[0])
        if image_link:
            results.append({"url": image_link, "name": keyword})
        else:
            return f"No image link found for keyword: {keyword}"
    try:
        requests.post(
            f"{os.environ.get('API_URL')}/show-image",
            json={"params": results},
        )
        return f"Images was successfully crawled and displayed.\n\nresults: {results}"
    except Exception as e:
        return f"An error occurred while crawling image URLs: {e}"


@tool
def bulk_crawl_images(keyword: str, count: int = 5) -> list[str] | str | None:
    """
    Fetches multiple image URLs for a single keyword and sends them all to the display API in one request.

    Args:
        keyword (str): The search term used to find images.
        count (int): The maximum number of images to fetch and display. Defaults to 5.

    Returns:
        list[str] | str | None: A success message with the total count if images were
        sent, an error message if the request fails, or a message indicating no images
        were found for the keyword.
    """
    print(
        f"[Nexus] Starting bulk image crawl for keyword: '{keyword}' (requested: {count} images)..."
    )
    image_links: list[str] = _get_image_links(keyword, max_images=count)
    if image_links:
        try:
            params = {
                "params": [
                    {"url": link, "name": f"{keyword}_{i + 1}"}
                    for i, link in enumerate(image_links)
                ]
            }
            requests.post(
                f"{os.environ.get('API_URL')}/show-image",
                json=params,
            )
            return f"{len(image_links)} images for '{keyword}' were successfully crawled and displayed."
        except Exception as e:
            return f"An error occurred while crawling image URLs: {e}"
    else:
        return f"No image links found for keyword: {keyword}"
