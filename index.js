const express = require('express')
const cors = require('cors')
const app = express()
require('dotenv').config()
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.Stripe_Secret);

const crypto = require("crypto");

function generateTrackingId(prefix = "ZAP") {
    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    const dateStr = `${year}${month}${day}`;    // e.g., 20250202
    const randomHex = crypto.randomBytes(3).toString("hex").toUpperCase(); // e.g., A3F91B

    return `${prefix}${dateStr}${randomHex}`;
}

// middleware
app.use(express.json());
app.use(cors());

const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const verifyFBToken = async(req, res, next) =>{
  //  console.log('header in the middleware', req.headers.authorization);
   const token = req.headers.authorization;

   if(!token) {
    return res.status(401).send({message: 'unauthorize access'});
   }
   try{
  const IdToken= token.split(' ')[1];
  const decoded = await admin.auth().verifyIdToken(IdToken);
  console.log('decoded in the token', decoded);
  req.decoded_email = decoded.email
   next();

   }
   catch(err){
    return res.status(401).send({message:'unauthorize assess' })
   };
} 


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
    if (!client.topology?.isConnected()) {
  await client.connect();
}


   const db = client.db('zap-shift-resources');
   const userCollection = db.collection('users');
   const parcelsCollection = db.collection('parcels');
   const paymentCollection = db.collection('payments');
   const ridersCollection = db.collection('riders');

       // middle admin before allowing admin activity
        // must be used after verifyFBToken middleware
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded_email;
            const query = { email };
            const user = await userCollection.findOne(query);

            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' });
            }

            next();
        }

  //  user related api
     app.get('/users', verifyFBToken, async (req, res) => {
            const searchText = req.query.searchText;
            const query = {};

            if (searchText) {
                // query.displayName = {$regex: searchText, $options: 'i'}

                query.$or = [
                    { displayName: { $regex: searchText, $options: 'i' } },
                    { email: { $regex: searchText, $options: 'i' } },
                ]

            }

            const cursor = userCollection.find(query).sort({ createdAt: -1 }).limit(5);
            const result = await cursor.toArray();
            res.send(result);
        });



  app.post('/user', async(req, res)=>{
    const user = req.body;
    user.role = 'user'
    user.createdAt = new Date();
    const email = user.email;
    const userExit = await userCollection.findOne({email})
         if(userExit){
          return res.send({message:'user exit'})
         }
    const result = await userCollection.insertOne(user);
    res.send(result);
  })

   app.get('/users/:id', async (req, res) => {

        })

        app.get('/users/:email/role', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await userCollection.findOne(query);
            res.send({ role: user?.role || 'user' })
        })


     app.patch('/users/:id/role', verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const roleInfo = req.body;
            const query = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {
                    role: roleInfo.role
                }
            }
            const result = await userCollection.updateOne(query, updatedDoc)
            res.send(result);
        })


  //  parcel api
  app.get('/parcels', async(req, res)=>{
    const query = {}
    const {email, deliveryStatus } = req.query;
    if(email){
      query.senderEmail = email
    }

     if (deliveryStatus) {
                query.deliveryStatus = deliveryStatus
            }

    const option = {sort : {createdAt: -1}}
    const cursor = parcelsCollection.find(query, option);
    const result = await cursor.toArray()
    res.send(result)

  });

  app.get('/parcels/:id', async(req, res)=>{
    const id = req.params.id;
    const query = {_id: new ObjectId(id)};
    const result = await parcelsCollection.findOne(query);
    res.send(result);
  })
 
  app.post('/parcels', async(req, res)=>{
   const data = req.body
  //  parcel create time
   data.createdAt= new Date();

   const result = await parcelsCollection.insertOne(data);
   res.send(result);
  })


   app.patch('/parcels/:id', async (req, res) => {
            const { riderId, riderName, riderEmail } = req.body;
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }

            const updatedDoc = {
                $set: {
                    deliveryStatus: 'driver_assigned',
                    riderId: riderId,
                    riderName: riderName,
                    riderEmail: riderEmail
                }
            }

            const result = await parcelsCollection.updateOne(query, updatedDoc)

            // update rider information
            const riderQuery = { _id: new ObjectId(riderId) }
            const riderUpdatedDoc = {
                $set: {
                    workStatus: 'in_delivery'
                }
            }
            const riderResult = await ridersCollection.updateOne(riderQuery, riderUpdatedDoc);

            res.send(riderResult);

        })


  app.delete('/parcels/:id', async(req, res)=>{
      const id = req.params.id
      const query = {_id: new ObjectId(id)};
      const result = await parcelsCollection.deleteOne(query);
      res.send(result);
  })

  // payment related api
  app.post('/create-checkout-session', async(req, res)=>{
    const paymentInfo = req.body;
    const amount = parseInt(paymentInfo.cost)*100;
     const session = await stripe.checkout.sessions.create({
    line_items: [
      {
        // Provide the exact Price ID (for example, price_1234) of the product you want to sell
        price_data: {
          currency : 'USD',
          unit_amount : amount,
          product_data : {
            name : paymentInfo.parcelName
          }
        },
        
        quantity: 1,
      },
    ],
    customer_email: paymentInfo.senderEmail,
    mode: 'payment',
    metadata : {
      parcelId : paymentInfo.parcelId,
      parcelName : paymentInfo.parcelName
    },
    success_url: `${process.env.Site_Domain}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.Site_Domain}/dashboard/payment-cancel`,
  });

  console.log(session);
  res.send({url : session.url})
  })

    app.patch('/payment-success',  async(req, res)=>{
      const sessionId = req.query.session_id;
     const session = await stripe.checkout.sessions.retrieve(sessionId);

    //  console.log('session retrieve', session);
       const transactionId = session.payment_intent;
       const query = {transactionId : transactionId}

       const paymentExist = await paymentCollection.findOne(query);
       if(paymentExist){
          return res.send({message: 'already exist', transactionId,
          trackingId : paymentExist.trackingId

          })
       }
     
     const trackingId = generateTrackingId();


     if(session.payment_status === 'paid'){
      const id = session.metadata.parcelId;
      const query = { _id: new ObjectId(id) }
      const update = {
            $set : {
                paymentStatus : 'paid',
                deliveryStatus : 'pending-pickup',
                 trackingId : trackingId
            }
      }
      const result = await parcelsCollection.updateOne(query, update);

      const payment ={
              amount :  session.amount_total/100,
              currency : session.currency,
              customerEmail : session.customer_email,
              parcelId : session.metadata.parcelId,
              parcelName : session.metadata.parcelName,
              transactionId : session.payment_intent,
              paymentStatus : session.payment_status,
              paidAt : new Date(),
              trackingId: trackingId
             
      }
      if(session.payment_status === 'paid'){
          const resultPayment = await paymentCollection.insertOne(payment);
          res.send({success : true,
             modifyParcel: result, 
             trackingId : trackingId,
             transactionId : session.payment_intent,
             paymentInfo: resultPayment
             })
      }

      // res.send(result) ;

     }

      res.send({success:false})

    })   

    // payment related api
    app.get('/payments',verifyFBToken, async(req, res)=>{
      const email = req.query.email
      const query ={}
      // console.log(req.headers)
      if(email){
        query.customerEmail = email;

        // check email address

        if(email !==  req.decoded_email){
          return res.status(403).send({massage : 'forbidden access'})
        }
      }
      const cursor = paymentCollection.find(query).sort({paidAt: -1});
      const result = await cursor.toArray();
      res.send(result);
    })

    // riders related api
  app.get('/riders', async(req, res)=>{
    const { status, district, workStatus } = req.query;
    const query = {}

           if (status) {
                query.status = status;
            }
            if (district) {
                query.district = district
            }
            if (workStatus) {
                query.workStatus = workStatus
            }
    const cursor = ridersCollection.find(query);
    const result =  await cursor.toArray();
    res.send(result);
  })

    app.post('/riders',  async(req, res)=>{
    const rider = req.body;
    rider.status ='pending';
    rider.createdAt = new Date();

    const result = await ridersCollection.insertOne(rider);
    res.send(result);
    
    })


     app.patch('/riders/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const status = req.body.status;
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {
                    status: status,
                    workStatus: 'available'
                }
            }

            const result = await ridersCollection.updateOne(query, updatedDoc);

            if (status === 'approved') {
                const email = req.body.email;
                const userQuery = { email }
                const updateUser = {
                    $set: {
                        role: 'rider'
                    }
                }
                const userResult = await userCollection.updateOne(userQuery, updateUser);
            }

            res.send(result);
        })



    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('zap shift resource running ...')
})

module.exports = app;



// app.listen(port, () => {
//   console.log(`Example app listening on port ${port}`)
// })
