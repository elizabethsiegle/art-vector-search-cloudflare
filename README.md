### 🌟 Overview
ArtVision AI is a sophisticated art search engine that uses AI to analyze and find visually similar artworks. It combines:

- LLaVA (hosted on Cloudflare Workers AI) for image understanding

- BGE embeddings (hosted on Cloudflare Workers AI) for semantic search

- Vector databases (Cloudflare Vectorize) for efficient similarity matching

- LLM explanations (Llama-3 hosted on Cloudflare Workers AI) for intuitive results

#### 📚 API Endpoints
Endpoint	Method	Description
/embed	POST	Upload and analyze artwork
/search	POST	Search for similar artworks
/clear	POST	Clear the vector database

#### 🚀 Deployment
1. Set up Cloudflare Workers:
```bash
npm install -g wrangler
npx wrangler login
```

2. Make your vector indices via the command line to use the Cloudflare Vectorize vector database
```bash
npx wrangler vectorize create art-vector-index --dimensions=768 --metric=cosine
```

3. Configure AI bindings in `wrangler.jsonc`
```json
"ai": {
		"binding": "AI"
	},
	"vectorize": [
    {
      "binding": "VECTORIZE",
      "index_name": "art-vector-index"
    }
  ]
```

4. Deploy! 🚀
```bash
npx wrangler deploy
```

