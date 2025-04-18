const jwt = require('jsonwebtoken');
const verifyApiKey = require('../utils/verifyApiKey');
const generateApiKey = require('../utils/generateApiKey');
const convertToHours = require('../utils/time/convertToHours');

const verifyJWT = (token, secret) => {
  return new Promise((resolve, reject) => {
    jwt.verify(token, secret, (err, decoded) => {
      if (err) {
        resolve({ isValid: false, error: err.message });
      } else {
        resolve({ isValid: true, decoded });
      }
    });
  });
};

const authenticateToken = async (req, res, next) => {
  const accessToken = req.headers['authorization']?.split(' ')[1];
  const apiKey = req.headers['x-api-key']

  if (!accessToken || !apiKey) {
    return res.status(401).json({ error: 'Missing tokens or device ID' });
  }

  // Verify Access Token First
  const { isValid, decoded } = await verifyJWT(accessToken, process.env.JWT_ACCESS_SECRET);
  if (isValid) {
    req.user = decoded;
    // convert the id back to BigInt
    req.user.id = BigInt(decoded.id);

    return next();
  }

  // Verify the Api Key Before Querying Database
  if (!verifyApiKey(apiKey)) {
    return res.status(403).json({ error: 'Invalid api key' });
  }

  // Lookup the Api Key in the Database
  const device = await req.prisma.device.findUnique({
    where: { api_key: apiKey },
    include: { user: true },
  });

  if (!device) {
    return res.status(403).json({ error: 'Invalid api key' });
  }

  // Generate a New Access Token
  const newAccessToken = jwt.sign(
    {
      ...device.user,
      id: device.user.id.toString(), // Convert BigInt to string
      password: undefined, // Remove password from token payload
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN }
  );

  let newApiKey = apiKey;

  // Rotate Api Key if it's close to expiring
  const remainingTime = device.expiresAt - Date.now();
  const apiKeyThreshold = convertToHours(process.env.API_KEY_RENEW_THRESHOLD);

  if (remainingTime < apiKeyThreshold) {
    newApiKey = generateApiKey();

    await req.prisma.device.update({
      where: { id: device.id },
      data: {
        api_key: newApiKey,
        token_expires: new Date(Date.now() + convertToDays(process.env.API_KEY_EXPIRES_IN)),
      },
    });
  }

  // Set New Tokens in Headers
  res.setHeader('Authorization', `Bearer ${newAccessToken}`);
  res.setHeader('x-api-key', newApiKey);

  // Attach User ID to Request and Proceed
  req.user = device.user;
  next();
};

module.exports = authenticateToken;
