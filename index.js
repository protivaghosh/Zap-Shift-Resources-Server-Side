const express = require('express')
const cors = require('cors')
const app = express()
require('dotenv').config()
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion } = require('mongodb');

// middleware
app.use(express.json());
app.use(cors());
// zap-shift-resources
// I3RzYCLl0tI3gz94

const uri = `mongodb+srv://${process.env.DB_user}:${process.env.DB_Password}@cluster0.1wh8t.mongodb.net/?appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

   const db = client.db('zap-shift-resources');
   const parcelsCollection = db.collection('parcels');

  //  parcel api
  app.get('/parcels', async(req, res)=>{
    const query = {}
    const {email} = req.query;
    if(email){
      query.senderEmail = email
    }
    const option = {sort : {createdAt: -1}}
    const cursor = parcelsCollection.find(query, option);
    const result = await cursor.toArray()
    res.send(result)

  });
 
  app.post('/parcels', async(req, res)=>{
   const data = req.body
  //  parcel create time
   data.createdAt= new Date();

   const result = await parcelsCollection.insertOne(data);
   res.send(result);
  })


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('zap shift resource running ...')
})


app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
