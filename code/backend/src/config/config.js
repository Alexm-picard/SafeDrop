// No AI Contribution

import dotenv from 'dotenv';
dotenv.config();

const config = {
    port: process.env.PORT || 4000,
    mongodb:{
        uri: process.env.MONGO_URI,
        dbName: process.env.MONGO_DB_NAME,
    }
}


export default config;