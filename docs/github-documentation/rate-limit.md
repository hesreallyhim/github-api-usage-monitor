---
markdown-link: https://docs.github.com/en/rest/rate-limit/rate-limit.md
redirect-link: https://docs.github.com/api/article/body?pathname=/en/rest/rate-limit/rate-limit
content-sha256: eab796b16a014b82e54bd3bc27e37f3b0ea8fee2ff127c5c3930d0576f7d44d1
---
# REST API endpoints for rate limits

Use the REST API to check your current rate limit status.

## About rate limits

You can check your current rate limit status at any time. For more information about rate limit rules, see [Rate limits for the REST API](/en/rest/overview/rate-limits-for-the-rest-api).

The REST API for searching items has a custom rate limit that is separate from the rate limit governing the other REST API endpoints. For more information, see [REST API endpoints for search](/en/rest/search/search). The GraphQL API also has a custom rate limit that is separate from and calculated differently than rate limits in the REST API. For more information, see [Rate limits and query limits for the GraphQL API](/en/graphql/overview/resource-limitations#rate-limit). For these reasons, the API response categorizes your rate limit. Under `resources`, you'll see objects relating to different categories:

* The `core` object provides your rate limit status for all non-search-related resources in the REST API.

* The `search` object provides your rate limit status for the REST API for searching (excluding code searches). For more information, see [REST API endpoints for search](/en/rest/search/search).

* The `code_search` object provides your rate limit status for the REST API for searching code. For more information, see [REST API endpoints for search](/en/rest/search/search#search-code).

* The `graphql` object provides your rate limit status for the GraphQL API.

* The `integration_manifest` object provides your rate limit status for the `POST /app-manifests/{code}/conversions` operation. For more information, see [Registering a GitHub App from a manifest](/en/apps/creating-github-apps/setting-up-a-github-app/creating-a-github-app-from-a-manifest#3-you-exchange-the-temporary-code-to-retrieve-the-app-configuration).

* The `dependency_snapshots` object provides your rate limit status for submitting snapshots to the dependency graph. For more information, see [REST API endpoints for the dependency graph](/en/rest/dependency-graph).

* The `code_scanning_upload` object provides your rate limit status for uploading SARIF results to code scanning. For more information, see [Uploading a SARIF file to GitHub](/en/code-security/code-scanning/integrating-with-code-scanning/uploading-a-sarif-file-to-github).

* The `actions_runner_registration` object provides your rate limit status for registering self-hosted runners in GitHub Actions. For more information, see [REST API endpoints for self-hosted runners](/en/rest/actions/self-hosted-runners).

For more information on the headers and values in the rate limit response, see [Rate limits for the REST API](/en/rest/overview/rate-limits-for-the-rest-api).

## Get rate limit status for the authenticated user

```
GET /rate_limit
```

Note

Accessing this endpoint does not count against your REST API rate limit.

Some categories of endpoints have custom rate limits that are separate from the rate limit governing the other REST API endpoints. For this reason, the API response categorizes your rate limit. Under resources, you'll see objects relating to different categories:

The core object provides your rate limit status for all non-search-related resources in the REST API.
The search object provides your rate limit status for the REST API for searching (excluding code searches). For more information, see "Search."
The code\_search object provides your rate limit status for the REST API for searching code. For more information, see "Search code."
The graphql object provides your rate limit status for the GraphQL API. For more information, see "Resource limitations."
The integration\_manifest object provides your rate limit status for the POST /app-manifests/{code}/conversions operation. For more information, see "Creating a GitHub App from a manifest."
The dependency\_snapshots object provides your rate limit status for submitting snapshots to the dependency graph. For more information, see "Dependency graph."
The dependency\_sbom object provides your rate limit status for requesting SBOMs from the dependency graph. For more information, see "Dependency graph."
The code\_scanning\_upload object provides your rate limit status for uploading SARIF results to code scanning. For more information, see "Uploading a SARIF file to GitHub."
The actions\_runner\_registration object provides your rate limit status for registering self-hosted runners in GitHub Actions. For more information, see "Self-hosted runners."
The source\_import object is no longer in use for any API endpoints, and it will be removed in the next API version. For more information about API versions, see "API Versions."

Note

The rate object is closing down. If you're writing new API client code or updating existing code, you should use the core object instead of the rate object. The core object contains the same information that is present in the rate object.

### HTTP response status codes

* **200** - OK

* **304** - Not modified

* **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/rate_limit \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Authorization: Bearer <YOUR-TOKEN>" \
  -H "X-GitHub-Api-Version: 2022-11-28"
```

**Response schema:**

```json
Status: 200

{
  "title": "Rate Limit Overview",
  "description": "Rate Limit Overview",
  "type": "object",
  "properties": {
    "resources": {
      "type": "object",
      "properties": {
        "core": {
          "title": "Rate Limit",
          "type": "object",
          "properties": {
            "limit": {
              "type": "integer"
            },
            "remaining": {
              "type": "integer"
            },
            "reset": {
              "type": "integer"
            },
            "used": {
              "type": "integer"
            }
          },
          "required": [
            "limit",
            "remaining",
            "reset",
            "used"
          ]
        },
        "graphql": {
          "title": "Rate Limit",
          "type": "object",
          "properties": {
            "limit": {
              "type": "integer"
            },
            "remaining": {
              "type": "integer"
            },
            "reset": {
              "type": "integer"
            },
            "used": {
              "type": "integer"
            }
          },
          "required": [
            "limit",
            "remaining",
            "reset",
            "used"
          ]
        },
        "search": {
          "title": "Rate Limit",
          "type": "object",
          "properties": {
            "limit": {
              "type": "integer"
            },
            "remaining": {
              "type": "integer"
            },
            "reset": {
              "type": "integer"
            },
            "used": {
              "type": "integer"
            }
          },
          "required": [
            "limit",
            "remaining",
            "reset",
            "used"
          ]
        },
        "code_search": {
          "title": "Rate Limit",
          "type": "object",
          "properties": {
            "limit": {
              "type": "integer"
            },
            "remaining": {
              "type": "integer"
            },
            "reset": {
              "type": "integer"
            },
            "used": {
              "type": "integer"
            }
          },
          "required": [
            "limit",
            "remaining",
            "reset",
            "used"
          ]
        },
        "source_import": {
          "title": "Rate Limit",
          "type": "object",
          "properties": {
            "limit": {
              "type": "integer"
            },
            "remaining": {
              "type": "integer"
            },
            "reset": {
              "type": "integer"
            },
            "used": {
              "type": "integer"
            }
          },
          "required": [
            "limit",
            "remaining",
            "reset",
            "used"
          ]
        },
        "integration_manifest": {
          "title": "Rate Limit",
          "type": "object",
          "properties": {
            "limit": {
              "type": "integer"
            },
            "remaining": {
              "type": "integer"
            },
            "reset": {
              "type": "integer"
            },
            "used": {
              "type": "integer"
            }
          },
          "required": [
            "limit",
            "remaining",
            "reset",
            "used"
          ]
        },
        "code_scanning_upload": {
          "title": "Rate Limit",
          "type": "object",
          "properties": {
            "limit": {
              "type": "integer"
            },
            "remaining": {
              "type": "integer"
            },
            "reset": {
              "type": "integer"
            },
            "used": {
              "type": "integer"
            }
          },
          "required": [
            "limit",
            "remaining",
            "reset",
            "used"
          ]
        },
        "actions_runner_registration": {
          "title": "Rate Limit",
          "type": "object",
          "properties": {
            "limit": {
              "type": "integer"
            },
            "remaining": {
              "type": "integer"
            },
            "reset": {
              "type": "integer"
            },
            "used": {
              "type": "integer"
            }
          },
          "required": [
            "limit",
            "remaining",
            "reset",
            "used"
          ]
        },
        "scim": {
          "title": "Rate Limit",
          "type": "object",
          "properties": {
            "limit": {
              "type": "integer"
            },
            "remaining": {
              "type": "integer"
            },
            "reset": {
              "type": "integer"
            },
            "used": {
              "type": "integer"
            }
          },
          "required": [
            "limit",
            "remaining",
            "reset",
            "used"
          ]
        },
        "dependency_snapshots": {
          "title": "Rate Limit",
          "type": "object",
          "properties": {
            "limit": {
              "type": "integer"
            },
            "remaining": {
              "type": "integer"
            },
            "reset": {
              "type": "integer"
            },
            "used": {
              "type": "integer"
            }
          },
          "required": [
            "limit",
            "remaining",
            "reset",
            "used"
          ]
        },
        "dependency_sbom": {
          "title": "Rate Limit",
          "type": "object",
          "properties": {
            "limit": {
              "type": "integer"
            },
            "remaining": {
              "type": "integer"
            },
            "reset": {
              "type": "integer"
            },
            "used": {
              "type": "integer"
            }
          },
          "required": [
            "limit",
            "remaining",
            "reset",
            "used"
          ]
        },
        "code_scanning_autofix": {
          "title": "Rate Limit",
          "type": "object",
          "properties": {
            "limit": {
              "type": "integer"
            },
            "remaining": {
              "type": "integer"
            },
            "reset": {
              "type": "integer"
            },
            "used": {
              "type": "integer"
            }
          },
          "required": [
            "limit",
            "remaining",
            "reset",
            "used"
          ]
        }
      },
      "required": [
        "core",
        "search"
      ]
    },
    "rate": {
      "title": "Rate Limit",
      "type": "object",
      "properties": {
        "limit": {
          "type": "integer"
        },
        "remaining": {
          "type": "integer"
        },
        "reset": {
          "type": "integer"
        },
        "used": {
          "type": "integer"
        }
      },
      "required": [
        "limit",
        "remaining",
        "reset",
        "used"
      ]
    }
  },
  "required": [
    "rate",
    "resources"
  ]
}
```