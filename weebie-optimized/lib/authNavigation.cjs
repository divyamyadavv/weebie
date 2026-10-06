function logoDestination(user,explicitHref){
 if(typeof explicitHref==="string")return explicitHref;
 return user?"/dashboard":"/";
}

function landingDestination(user,requiresVerification){
 if(!user)return null;
 return requiresVerification?"/verify-email?next=%2Fdashboard":"/dashboard";
}

module.exports={logoDestination,landingDestination};
