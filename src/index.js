import html from '../static/index.html';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html',
        },
      });
    }
    if (url.pathname === "/embed") {
      return handleEmbedRequest(request, env);
    } else if (url.pathname === "/search") {
      return handleSearchRequest(request, env);
    } else if (url.pathname === "/clear") {
      return handleClearRequest(request, env);
    }
    
    return new Response("Not found", { status: 404 });
  }
};

async function handleClearRequest(request, env) {
  try {
    const allVectors = await env.VECTORIZE.query(Array(768).fill(0), {
      topK: 100,
      returnVectors: true
    });

    if (allVectors.matches && allVectors.matches.length > 0) {
      const vectorIds = allVectors.matches.map(match => match.id);
      await env.VECTORIZE.deleteByIds(vectorIds);
      
      return new Response(JSON.stringify({ 
        success: true, 
        message: `Cleared ${vectorIds.length} artworks.`
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ 
      success: true, 
      message: "No artworks to clear"
    }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function handleEmbedRequest(request, env) {
	const { imageUrl } = await request.json();
	
	if (!imageUrl) {
	  return new Response(JSON.stringify({ error: "Missing image URL" }), { status: 400 });
	}
  
	try {
	  // Step 1: Get the image data with timeout
	  const controller = new AbortController();
	  const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout
	  
	  const imageResponse = await fetch(imageUrl, { signal: controller.signal });
	  clearTimeout(timeout);
	  
	  if (!imageResponse.ok) {
		throw new Error(`Failed to fetch image: ${imageResponse.statusText}`);
	  }
	  
	  // Verify content type is an image
	  const contentType = imageResponse.headers.get('content-type');
	  if (!contentType || !contentType.startsWith('image/')) {
		throw new Error('URL does not point to a valid image');
	  }
	  
	  const imageBlob = await imageResponse.arrayBuffer();
	  
	  // Step 2: Analyze the image with LLaVA
	  const llavaInput = {
		image: [...new Uint8Array(imageBlob)],
		prompt: "Describe this artwork in detail. Include: 1. Main subject 2. Color palette 3. Artistic style 4. Composition. Be specific.",
		max_tokens: 512
	  };
	  
	  const llavaResponse = await env.AI.run(
		"@cf/llava-hf/llava-1.5-7b-hf",
		llavaInput,
		{
			gateway: {
				id: "art-vector",
				skipCache: false,
				cacheTtl: 3360,
			},
		}
	  );
	  
	  console.log("Raw LLaVA response:", JSON.stringify(llavaResponse));
	  
	  // get the description from the response
	  let description = llavaResponse.description;
	  
	  // Clean up the description if needed
	  description = description.trim();
	  if (description === "" || description.toLowerCase().includes("sorry") || 
		  description.toLowerCase().includes("cannot")) {
		description = "No description generated";
	  }
	  
	  console.log("Final description:", description);
	  
	  // Step 3: Create text embeddings from the description
	  const embeddings = await env.AI.run(
		"@cf/baai/bge-base-en-v1.5",
		{ text: [description] },
		{
			gateway: {
				id: "art-vector",
				skipCache: false,
				cacheTtl: 3360,
			},
		}
	  );
	  
	  // Step 4: Store in vector database
	  const vector = {
		id: `art-${Date.now()}`,
		values: embeddings.data[0],
		metadata: {
		  imageUrl,
		  description,
		  timestamp: Date.now()
		}
	  };
  
	  await env.VECTORIZE.upsert([vector]);
  
	  return new Response(JSON.stringify({ 
		success: true, 
		imageUrl,
		description,
		vectorId: vector.id
	  }), {
		headers: { "Content-Type": "application/json" }
	  });
	} catch (error) {
	  console.error("Error in handleEmbedRequest:", error);
	  return new Response(JSON.stringify({ 
		error: error.message,
		details: "Failed to process artwork - please try a different image"
	  }), { 
		status: 500,
		headers: { "Content-Type": "application/json" }
	  });
	}
  }

  async function handleSearchRequest(request, env) {
	const { textQuery } = await request.json();
	
	if (!textQuery) {
	  return new Response(JSON.stringify({ error: "Please enter a search query" }), { status: 400 });
	}
  
	try {
	  // Step 1: Create embeddings for the search query
	  const queryEmbedding = await env.AI.run(
		"@cf/baai/bge-base-en-v1.5",
		{ text: [textQuery] }
	  );
  
	  // Step 2: Search the vector database
	  const result = await env.VECTORIZE.query(queryEmbedding.data[0], { 
		topK: 5,
		returnMetadata: true
	  });
  
	  if (!result.matches || result.matches.length === 0) {
		return new Response(JSON.stringify({ 
		  error: "No artworks found matching your query",
		  textQuery
		}), { status: 404 });
	  }
  
	  // Process matches
	  const matches = result.matches
		.filter(match => match.score >= 0.3)
		.map(match => ({
		  url: match.metadata?.imageUrl,
		  description: match.metadata?.description,
		  score: match.score
		}))
		.filter(match => match.url);
  
	  if (matches.length === 0) {
		return new Response(JSON.stringify({ 
		  error: "No strong matches found",
		  textQuery
		}), { status: 404 });
	  }
  
	  // Sort matches by score (descending)
	  matches.sort((a, b) => b.score - a.score);
  
	  // Step 3: Generate explanation for top 2 matches
	  let explanation = "";
	  if (matches.length >= 2) {
		const messages = [
		  {
			role: "system",
			content: "You are an art expert analyzing why certain artworks match a search query. Provide a concise comparison (under 150 words) of the top 2 matches."
		  },
		  {
			role: "user",
			content: `Explain why these are the top matches for "${textQuery}":
			
			First match (${(matches[0].score * 100).toFixed(1)}% similar):
			${matches[0].description}
			
			Second match (${(matches[1].score * 100).toFixed(1)}% similar):
			${matches[1].description}
			
			Focus on visual similarities and artistic qualities.`
		  },
		];
  
		const llmResponse = await env.AI.run(
		  "@cf/meta/llama-3.3-70b-instruct-fp8-fast", 
		  { messages },
		  {
			gateway: {
			  id: "art-vector",
			  skipCache: false,
			  cacheTtl: 3360,
			},
		  }
		);
		
		explanation = llmResponse.response || "No comparison available";
	  }
  
	  return new Response(JSON.stringify({
		textQuery,
		matches,
		explanation: matches.length >= 2 ? explanation : "Not enough matches for comparison"
	  }), {
		headers: { "Content-Type": "application/json" }
	  });
	} catch (error) {
	  console.error("Error in handleSearchRequest:", error);
	  return new Response(JSON.stringify({ 
		error: error.message,
		textQuery
	  }), { 
		status: 500,
		headers: { "Content-Type": "application/json" }
	  });
	}
  }